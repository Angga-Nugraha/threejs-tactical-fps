// The match: rounds, phases, money and the beacon. One state object, one update
// function, events out through onEvent so main.js can wire HUD, bots and audio.
// Phases: 'buy' (15 s, shop open) -> 'live' (100 s) -> 'planted' (35 s fuse) ->
// 'end' (4 s banner) -> next round. First to 4 round wins takes the match (max 7).
import { WEAPONS, GRENADE, VEST } from './weapons.js';

export const BUY_TIME = 15;
export const ROUND_TIME = 100;
export const FUSE_TIME = 35;
export const END_TIME = 4;
export const WIN_ROUNDS = 4;
export const MAX_ROUNDS = 7;

export const SHOP = [
  { id: 'scatter', name: WEAPONS.scatter.name, desc: 'Close quarters, 8 pellets', price: WEAPONS.scatter.price, key: '2' },
  { id: 'pike', name: WEAPONS.pike.name, desc: 'Full-auto rifle, 30 rounds', price: WEAPONS.pike.price, key: '3' },
  { id: 'longshot', name: WEAPONS.longshot.name, desc: 'High damage, slow fire', price: WEAPONS.longshot.price, key: '4' },
  { id: 'spark', name: GRENADE.name, desc: 'Arced throw, blast radius 7 m', price: GRENADE.price, key: '5' },
  { id: 'vest', name: VEST.name, desc: '+25 max health this round', price: VEST.price, key: '6' },
];

export function createMatch(onEvent) {
  const state = {
    round: 1,
    phase: 'buy',
    phaseTime: BUY_TIME,
    score: { vanguard: 0, warden: 0 },
    money: 800,
    kills: 0,
    deaths: 0,
    plants: 0,
    defuses: 0,
    beacon: { planted: false, x: 0, z: 0, siteId: null, fuseLeft: 0 },
    plant: { active: false, progress: 0, siteId: null },
    winner: null,
    matchWinner: null,
    over: false,
  };

  function emit(type, data) {
    if (onEvent) onEvent(type, data);
  }

  function startRound() {
    state.phase = 'buy';
    state.phaseTime = BUY_TIME;
    state.beacon.planted = false;
    state.beacon.siteId = null;
    state.plant.active = false;
    state.plant.progress = 0;
    state.winner = null;
    emit('round-start', { round: state.round });
  }

  function endRound(winner, reason) {
    if (state.phase === 'end' || state.over) return;
    state.phase = 'end';
    state.phaseTime = END_TIME;
    state.winner = winner;
    state.score[winner] += 1;
    if (winner === 'vanguard') {
      state.money += 325;
      emit('round-win', { winner, reason });
    } else {
      state.money += 150;
      emit('round-lose', { winner, reason });
    }
    if (state.score[winner] >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.matchWinner = state.score.vanguard > state.score.warden
        ? 'vanguard'
        : state.score.warden > state.score.vanguard ? 'warden' : 'draw';
      state.over = true;
    }
  }

  function nextRound() {
    state.round += 1;
    startRound();
  }

  function update(dt) {
    if (state.phase === 'end') {
      state.phaseTime -= dt;
      if (state.phaseTime <= 0) {
        if (state.over) emit('match-over', { winner: state.matchWinner });
        else nextRound();
      }
      return;
    }
    state.phaseTime -= dt;
    if (state.phase === 'buy' && state.phaseTime <= 0) {
      state.phase = 'live';
      state.phaseTime = ROUND_TIME;
      emit('round-live', {});
    } else if (state.phase === 'live' && state.phaseTime <= 0) {
      endRound('warden', 'Time expired — the beacon was never planted.');
    } else if (state.phase === 'planted') {
      state.beacon.fuseLeft -= dt;
      if (state.beacon.fuseLeft <= 0) {
        endRound('vanguard', 'The beacon detonated at the site.');
      }
    }
  }

  function plantBeacon(site) {
    state.beacon.planted = true;
    state.beacon.x = site.x;
    state.beacon.z = site.z;
    state.beacon.siteId = site.id;
    state.beacon.fuseLeft = FUSE_TIME;
    state.phase = 'planted';
    state.phaseTime = FUSE_TIME;
    state.plants += 1;
    state.money += 300;
    emit('planted', { site: site.id });
  }

  function onKill(victimTeam, killerTeam, killerIsPlayer) {
    if (killerIsPlayer && victimTeam === 'warden') {
      state.kills += 1;
      state.money += 300;
    }
    if (victimTeam === 'vanguard' && killerTeam === 'warden' && killerIsPlayer === false) {
      // Player death is tracked by main.js through the player actor.
    }
  }

  return {
    state,
    startRound,
    endRound,
    update,
    plantBeacon,
    onKill,
    phaseTime() {
      return Math.max(0, state.phaseTime);
    },
  };
}
