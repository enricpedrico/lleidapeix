use crate::model::{team_of, Card, Contract, PlayedCard, Seat};

pub fn card_beats(
    candidate: Card,
    incumbent: Card,
    lead: crate::model::Suit,
    trump: Option<crate::model::Suit>,
) -> bool {
    if candidate.suit == incumbent.suit {
        return candidate.rank.strength() > incumbent.rank.strength();
    }
    if Some(candidate.suit) == trump && Some(incumbent.suit) != trump {
        return true;
    }
    if Some(incumbent.suit) == trump {
        return false;
    }
    candidate.suit == lead && incumbent.suit != lead
}

pub fn winning_play(trick: &[PlayedCard], contract: Contract) -> Option<PlayedCard> {
    let lead = trick.first()?.card.suit;
    let mut winner = trick[0];
    for play in &trick[1..] {
        if card_beats(play.card, winner.card, lead, contract.trump()) {
            winner = *play;
        }
    }
    Some(winner)
}

pub fn legal_cards(
    hand: &[Card],
    trick: &[PlayedCard],
    contract: Contract,
    seat: Seat,
) -> Vec<Card> {
    if trick.is_empty() {
        return hand.to_vec();
    }

    let lead = trick[0].card.suit;
    let winner = winning_play(trick, contract).expect("a non-empty trick has a winner");
    let partner_winning = team_of(winner.seat) == team_of(seat);
    let following: Vec<Card> = hand
        .iter()
        .copied()
        .filter(|card| card.suit == lead)
        .collect();

    if !following.is_empty() {
        if partner_winning {
            return following;
        }
        let beating: Vec<Card> = following
            .iter()
            .copied()
            .filter(|card| card_beats(*card, winner.card, lead, contract.trump()))
            .collect();
        return if beating.is_empty() {
            following
        } else {
            beating
        };
    }

    if !partner_winning {
        if let Some(trump) = contract.trump() {
            let winning_trumps: Vec<Card> = hand
                .iter()
                .copied()
                .filter(|card| {
                    card.suit == trump && card_beats(*card, winner.card, lead, Some(trump))
                })
                .collect();
            if !winning_trumps.is_empty() {
                return winning_trumps;
            }
        }
    }

    hand.to_vec()
}

pub fn trick_points(trick: &[PlayedCard]) -> u8 {
    1 + trick.iter().map(|play| play.card.rank.points()).sum::<u8>()
}

pub fn hand_award(team_points: [u16; 2], multiplier: u8) -> [u16; 2] {
    if team_points[0] > 36 {
        [(team_points[0] - 36) * multiplier as u16, 0]
    } else if team_points[1] > 36 {
        [0, (team_points[1] - 36) * multiplier as u16]
    } else {
        [0, 0]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Rank, Suit};

    fn c(suit: Suit, rank: Rank) -> Card {
        Card::new(suit, rank)
    }

    #[test]
    fn deck_has_48_unique_cards_and_60_card_points() {
        let deck = Card::deck();
        let mut ids = deck.iter().map(|card| card.id).collect::<Vec<_>>();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(deck.len(), 48);
        assert_eq!(ids.len(), 48);
        assert_eq!(
            deck.iter()
                .map(|card| card.rank.points() as u16)
                .sum::<u16>(),
            60
        );
    }

    #[test]
    fn opponent_winning_forces_a_higher_card() {
        let trick = vec![PlayedCard {
            seat: 0,
            card: c(Suit::Copes, Rank::Rei),
        }];
        let hand = vec![
            c(Suit::Copes, Rank::Dos),
            c(Suit::Copes, Rank::As),
            c(Suit::Oros, Rank::Manilla),
        ];
        assert_eq!(
            legal_cards(&hand, &trick, Contract::Trump(Suit::Oros), 1),
            vec![c(Suit::Copes, Rank::As)]
        );
    }

    #[test]
    fn partner_winning_only_forces_following_suit() {
        let trick = vec![
            PlayedCard {
                seat: 0,
                card: c(Suit::Espases, Rank::Rei),
            },
            PlayedCard {
                seat: 1,
                card: c(Suit::Espases, Rank::Dos),
            },
        ];
        let hand = vec![
            c(Suit::Espases, Rank::Tres),
            c(Suit::Espases, Rank::As),
            c(Suit::Oros, Rank::Manilla),
        ];
        assert_eq!(
            legal_cards(&hand, &trick, Contract::Trump(Suit::Oros), 2).len(),
            2
        );
    }

    #[test]
    fn void_player_must_play_a_winning_trump_against_opponent() {
        let trick = vec![PlayedCard {
            seat: 0,
            card: c(Suit::Bastos, Rank::As),
        }];
        let hand = vec![
            c(Suit::Oros, Rank::Dos),
            c(Suit::Oros, Rank::Manilla),
            c(Suit::Copes, Rank::As),
        ];
        let legal = legal_cards(&hand, &trick, Contract::Trump(Suit::Oros), 1);
        assert_eq!(legal.len(), 2);
        assert!(legal.iter().all(|card| card.suit == Suit::Oros));
    }

    #[test]
    fn scoring_always_awards_only_the_excess() {
        assert_eq!(hand_award([42, 30], 1), [6, 0]);
        assert_eq!(hand_award([30, 42], 4), [0, 24]);
        assert_eq!(hand_award([36, 36], 8), [0, 0]);
    }
}
