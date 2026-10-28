//! Independent executable oracle for the western rules; no referee helpers in the oracle.
use std::collections::{BTreeMap, BTreeSet};
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use crate::{database::Database, engine::{Analyzer, InformationSet}, model::*, rules};

fn power(card: Card, lead: Suit, trump: Option<Suit>) -> u16 {
    let rank = match card.rank {
        Rank::Dos => 2, Rank::Tres => 3, Rank::Quatre => 4, Rank::Cinc => 5,
        Rank::Sis => 6, Rank::Set => 7, Rank::Vuit => 8, Rank::Sota => 10,
        Rank::Cavall => 11, Rank::Rei => 12, Rank::As => 13, Rank::Manilla => 14,
    };
    if Some(card.suit) == trump { 200 + rank }
    else if card.suit == lead { 100 + rank }
    else { 0 }
}

fn points(card: Card) -> u16 {
    match card.rank {
        Rank::Sota => 1, Rank::Cavall => 2, Rank::Rei => 3,
        Rank::As => 4, Rank::Manilla => 5, _ => 0,
    }
}

fn winner(trick: &[PlayedCard], contract: Contract) -> PlayedCard {
    *trick.iter().max_by_key(|p| power(p.card, trick[0].card.suit, contract.trump())).unwrap()
}

fn oracle(hand: &[Card], trick: &[PlayedCard], contract: Contract, seat: Seat) -> Vec<Card> {
    let Some(first) = trick.first() else { return hand.to_vec() };
    let leading = winner(trick, contract);
    let must_follow = hand.iter().any(|c| c.suit == first.card.suit);
    let can_beat = hand.iter().any(|c| (!must_follow || c.suit == first.card.suit)
        && power(*c, first.card.suit, contract.trump()) > power(leading.card, first.card.suit, contract.trump()));
    hand.iter().copied().filter(|c| {
        if must_follow && c.suit != first.card.suit { return false; }
        if leading.seat % 2 != seat % 2 && can_beat {
            return power(*c, first.card.suit, contract.trump()) > power(leading.card, first.card.suit, contract.trump());
        }
        true
    }).collect()
}

fn ids(cards: &[Card]) -> BTreeSet<u8> { cards.iter().map(|c| c.id).collect() }
fn card(s: Suit, r: Rank) -> Card { Card::new(s, r) }
fn play(seat: Seat, suit: Suit, rank: Rank) -> PlayedCard { PlayedCard { seat, card: card(suit, rank) } }

#[test]
fn explicit_obligations_for_every_suit_and_seat() {
    for trump in Suit::ALL {
        let lead = Suit::ALL[(trump.index() + 1) % 4];
        let other = Suit::ALL[(trump.index() + 2) % 4];
        for first in 0..4 {
            let next = (first + 1) % 4;
            let third = (first + 2) % 4;
            let contract = Contract::Trump(trump);
            let cases = vec![
                ("must follow and beat", vec![play(first, lead, Rank::Rei)], next,
                    vec![card(lead, Rank::Dos), card(lead, Rank::As), card(trump, Rank::Dos)], vec![card(lead, Rank::As)]),
                ("must ruff", vec![play(first, lead, Rank::Manilla)], next,
                    vec![card(other, Rank::As), card(trump, Rank::Dos)], vec![card(trump, Rank::Dos)]),
                ("must overruff", vec![play(first, lead, Rank::Manilla), play(next, trump, Rank::Rei)], third,
                    vec![card(other, Rank::As), card(trump, Rank::Dos), card(trump, Rank::As)], vec![card(trump, Rank::As)]),
                ("must follow even if ruffed", vec![play(first, lead, Rank::Dos), play(next, trump, Rank::Dos)], third,
                    vec![card(lead, Rank::Manilla), card(trump, Rank::Manilla)], vec![card(lead, Rank::Manilla)]),
                ("cannot overruff, free discard", vec![play(first, lead, Rank::Dos), play(next, trump, Rank::Manilla)], third,
                    vec![card(other, Rank::As), card(trump, Rank::Dos)], vec![card(other, Rank::As), card(trump, Rank::Dos)]),
                ("partner, follow without beating", vec![play(first, lead, Rank::Rei), play(next, lead, Rank::Dos)], third,
                    vec![card(lead, Rank::Tres), card(lead, Rank::As), card(trump, Rank::Dos)], vec![card(lead, Rank::Tres), card(lead, Rank::As)]),
                ("partner, no ruff required", vec![play(first, lead, Rank::Rei), play(next, lead, Rank::Dos)], third,
                    vec![card(other, Rank::As), card(trump, Rank::Dos)], vec![card(other, Rank::As), card(trump, Rank::Dos)]),
                ("trump lead must beat", vec![play(first, trump, Rank::Rei)], next,
                    vec![card(trump, Rank::Dos), card(trump, Rank::Manilla), card(lead, Rank::As)], vec![card(trump, Rank::Manilla)]),
            ];
            for (name, trick, seat, hand, expected) in cases {
                assert_eq!(ids(&oracle(&hand, &trick, contract, seat)), ids(&expected), "oracle: {name}");
                assert_eq!(ids(&rules::legal_cards(&hand, &trick, contract, seat)), ids(&expected), "referee: {name}");
            }
            let hand = vec![card(trump, Rank::Manilla), card(other, Rank::Dos)];
            let trick = vec![play(first, lead, Rank::Dos)];
            assert_eq!(ids(&rules::legal_cards(&hand, &trick, Contract::Botifarra, next)), ids(&hand));
        }
    }
}

fn case_name(game: &Game, legal: &[Card]) -> &'static str {
    let Some(first) = game.current_trick.first() else { return "lead" };
    let contract = game.contract.unwrap();
    let w = winner(&game.current_trick, contract);
    let hand = &game.hands[game.current_player];
    let follows = hand.iter().any(|c| c.suit == first.card.suit);
    let wins = legal.iter().any(|c| power(*c, first.card.suit, contract.trump()) > power(w.card, first.card.suit, contract.trump()));
    if w.seat % 2 == game.current_player % 2 { return if follows { "partner-follow" } else { "partner-discard" }; }
    if follows { return if wins { "follow-beat" } else { "follow-lose" }; }
    if wins { return if Some(w.card.suit) == contract.trump() { "overruff" } else { "ruff" }; }
    "free-discard"
}

#[test]
fn two_thousand_complete_hands_against_independent_oracle() {
    let mut rng = ChaCha8Rng::seed_from_u64(0xA0D172026);
    let mut fixtures = BTreeMap::<String, Game>::new();
    let mut turns = 0;
    let mut illegal_rejections = 0;
    for seed in 0..2000 {
        let mut game = Game::new_with_dealer(format!("{seed:032x}"), seed, GameMode::Match, Difficulty::Strong, (seed % 4) as usize);
        let original_dealer = game.dealer;
        let contract = if seed % 5 == 4 { Contract::Botifarra } else { Contract::Trump(Suit::ALL[(seed % 5) as usize]) };
        assert_eq!(ids(&game.hands.concat()).len(), 48);
        assert!(game.hands.iter().all(|h| h.len() == 12));
        assert!(game.play(game.current_player, game.hands[game.current_player][0].id).is_err());
        game.choose_contract(Some(contract), false).unwrap();
        let raises = (seed / 5 % 4) as u8;
        while game.phase == Phase::Doubling {
            game.respond_doubling(game.current_player, if game.doubling_level < raises { DoublingDecision::Raise } else { DoublingDecision::Pass }).unwrap();
        }
        assert_eq!(game.current_player, (original_dealer + 1) % 4);
        let expected_multiplier = if contract == Contract::Botifarra { 2 << raises.min(2) } else { 1 << raises };
        assert_eq!(game.multiplier(), expected_multiplier);
        let mut expected_points = [0u16; 2];
        let mut seen = BTreeSet::new();
        while game.phase == Phase::Playing {
            let seat = game.current_player;
            let hand = &game.hands[seat];
            let legal = oracle(hand, &game.current_trick, contract, seat);
            assert!(!legal.is_empty());
            assert_eq!(ids(&rules::legal_cards(hand, &game.current_trick, contract, seat)), ids(&legal), "seed={seed} turn={turns}");
            let mut view = game.clone();
            view.human_seat = seat;
            assert_eq!(view.public_state().legal_cards.into_iter().collect::<BTreeSet<_>>(), ids(&legal));
            assert_eq!(view.public_state().hand, *hand);
            let before = serde_json::to_value(&game).unwrap();
            if let Some(illegal) = hand.iter().find(|c| !legal.contains(c)) {
                let id = illegal.id;
                assert!(game.play(seat, id).is_err());
                assert_eq!(serde_json::to_value(&game).unwrap(), before);
                illegal_rejections += 1;
            }
            assert!(game.play((seat + 1) % 4, legal[0].id).is_err());
            assert!(game.play(seat, 255).is_err());
            assert_eq!(serde_json::to_value(&game).unwrap(), before);
            if seat == 0 {
                let name = format!("{}-{}", seed % 5, case_name(&game, &legal));
                fixtures.entry(name).or_insert_with(|| game.clone());
            }
            let c = legal[rng.gen_range(0..legal.len())];
            assert!(seen.insert(c.id));
            let mut trick = game.current_trick.clone();
            trick.push(PlayedCard { seat, card: c });
            game.play(seat, c.id).unwrap();
            if trick.len() == 4 {
                let w = winner(&trick, contract);
                let p = 1 + trick.iter().map(|p| points(p.card)).sum::<u16>();
                expected_points[w.seat % 2] += p;
                let actual = game.completed_tricks.last().unwrap();
                assert_eq!(actual.winner, w.seat);
                assert_eq!(actual.points as u16, p);
                assert_eq!(game.current_player, w.seat);
                assert_eq!(actual.cards.iter().map(|p| p.seat).collect::<BTreeSet<_>>().len(), 4);
                assert_eq!(game.team_points, expected_points);
            } else { assert_eq!(game.current_player, (seat + 1) % 4); }
            turns += 1;
        }
        assert_eq!(seen.len(), 48);
        assert_eq!(game.completed_tricks.len(), 12);
        assert_eq!(expected_points.iter().sum::<u16>(), 72);
        let award = expected_points.map(|p| p.saturating_sub(36) * expected_multiplier as u16);
        assert_eq!(game.match_score, award);
        assert_eq!(game.hand_result.as_ref().unwrap().awarded, award);
        assert_eq!(game.phase == Phase::MatchOver, award.iter().any(|p| *p >= 101));
        if game.phase == Phase::HandOver {
            game.next_hand().unwrap();
            assert_eq!(game.dealer, (original_dealer + 1) % 4);
            assert_eq!(game.current_player, game.dealer);
            assert_eq!(game.match_score, award);
            assert_eq!(game.hand_number, 2);
            assert!(game.contract.is_none() && game.completed_tricks.is_empty());
        } else { assert!(game.next_hand().is_err()); }
    }
    assert_eq!(turns, 96_000);
    assert!(illegal_rejections > 10_000);
    for suit in 0..4 {
        for case in ["lead", "ruff", "overruff", "follow-beat", "follow-lose", "partner-follow", "partner-discard", "free-discard"] {
            assert!(fixtures.contains_key(&format!("{suit}-{case}")), "missing {suit}-{case}");
        }
    }
    let mut exported = Vec::new();
    let out = std::env::var("AUDIT_FIXTURE_DIR").ok();
    let db = out.as_ref().map(|dir| Database::open(&format!("{dir}/fixtures.sqlite")).unwrap());
    for (i, (name, mut game)) in fixtures.into_iter().enumerate() {
        // Exercise recommendations on real mid-hand positions, not invented incomplete deals.
        let expected = ids(&oracle(&game.hands[0], &game.current_trick, game.contract.unwrap(), 0));
        let mut analyzer = Analyzer::new(InformationSet::from_game(&game, 0).unwrap());
        analyzer.step(24);
        let update = analyzer.update("complete");
        assert!(!update.candidates.is_empty());
        assert!(update.candidates.iter().all(|c| expected.contains(&c.card.id)));
        game.id = format!("{i:032x}");
        if let Some(db) = &db { db.save_game(&game).unwrap(); }
        exported.push(serde_json::json!({ "name": name, "id": game.id, "state": game.public_state(), "legal": expected,
            "illegal": game.hands[0].iter().filter(|c| !expected.contains(&c.id)).map(|c| c.id).collect::<Vec<_>>() }));
    }
    if let Some(dir) = out {
        std::fs::write(format!("{dir}/fixtures.json"), serde_json::to_vec_pretty(&exported).unwrap()).unwrap();
        std::fs::write(format!("{dir}/audit.json"), serde_json::to_vec_pretty(&serde_json::json!({ "hands": 2000, "turns": turns, "illegalRejections": illegal_rejections, "fixtures": exported.len() })).unwrap()).unwrap();
    }
}

#[test]
fn bidding_and_doubling_turns_and_delegation() {
    for dealer in 0..4 {
        for delegate in [false, true] {
            for botifarra in [false, true] {
                let mut g = Game::new_with_dealer("audit".into(), 98, GameMode::Match, Difficulty::Strong, dealer);
                g.choose_contract(Some(if botifarra { Contract::Botifarra } else { Contract::Trump(Suit::Oros) }), delegate).unwrap();
                assert_eq!(g.declarer, Some(if delegate { (dealer + 2) % 4 } else { dealer }));
                assert!(g.choose_contract(None, true).is_err());
                let max_level = if g.contract == Some(Contract::Botifarra) { 2 } else { 3 };
                for level in 0..max_level {
                    let team = (dealer + 1 + level) % 2;
                    assert_eq!(g.current_player % 2, team);
                    let before = serde_json::to_value(&g).unwrap();
                    assert!(g.respond_doubling((g.current_player + 1) % 4, DoublingDecision::Raise).is_err());
                    assert!(g.play(g.current_player, g.hands[g.current_player][0].id).is_err());
                    assert_eq!(serde_json::to_value(&g).unwrap(), before);
                    let first = g.current_player;
                    g.respond_doubling(first, DoublingDecision::Pass).unwrap();
                    assert_eq!(g.current_player, (first + 2) % 4);
                    g.respond_doubling(g.current_player, DoublingDecision::Raise).unwrap();
                }
                assert_eq!(g.phase, Phase::Playing);
                assert_eq!(g.current_player, (dealer + 1) % 4);
                assert!(g.respond_doubling(g.current_player, DoublingDecision::Raise).is_err());
            }
        }
    }
    for total in 0..=72 {
        for multiplier in [1, 2, 4, 8] {
            assert_eq!(rules::hand_award([total, 72-total], multiplier), [total.saturating_sub(36) * multiplier as u16, (72-total).saturating_sub(36) * multiplier as u16]);
        }
    }
}
