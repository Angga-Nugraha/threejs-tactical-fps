// The HUD: every DOM readout, the kill feed, the buy menu, banners and overlays.
// All updates are cheap text/width writes; the module never reads game state back.
import { SHOP } from './rounds.js';

export function createHud(callbacks) {
  const el = (id) => document.getElementById(id);
  const hpFill = el('hp-fill');
  const hpNum = el('hp-num');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const ammoBox = el('ammo');
  const timerEl = el('timer');
  const scoreEl = el('score-value');
  const moneyEl = el('money-value');
  const aliveEl = el('alive-value');
  const feedEl = el('feed');
  const bannerEl = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const plantBar = el('plant-bar');
  const plantFill = el('plant-fill');
  const plantLabel = el('plant-label');
  const vignette = el('vignette');
  const buyEl = el('buy');
  const buyItems = el('buy-items');
  const buyMoney = el('buy-money');
  const overlay = el('overlay');
  const overlayTitle = el('overlay-title');
  const overlayCopy = el('overlay-copy');
  const playBtn = el('play');
  const weaponSlots = el('weapon-slots');
  const grenadeCount = el('grenade-count');
  const roundLabel = el('round-label');

  let hitTimer = 0;
  let bannerTimer = 0;

  function buildBuy() {
    buyItems.innerHTML = '';
    for (const item of SHOP) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'buy-row';
      row.dataset.id = item.id;
      row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">$${item.price}</span>`;
      row.addEventListener('click', () => callbacks.onBuy(item.id));
      buyItems.appendChild(row);
    }
  }
  buildBuy();

  function buildSlots() {
    weaponSlots.innerHTML = '';
    const slots = [
      { key: '1', id: 'p9', label: 'P9' },
      { key: '2', id: 'scatter', label: 'Broom' },
      { key: '3', id: 'pike', label: 'Pike' },
      { key: '4', id: 'longshot', label: 'Needle' },
      { key: '5', id: 'spark', label: 'Spark' },
    ];
    for (const s of slots) {
      const div = document.createElement('div');
      div.className = 'slot';
      div.id = `slot-${s.id}`;
      div.innerHTML = `<b>${s.key}</b> ${s.label}`;
      weaponSlots.appendChild(div);
    }
  }
  buildSlots();

  playBtn.addEventListener('click', () => callbacks.onPlay());

  return {
    setHealth(hp, max) {
      const frac = Math.max(0, hp / max);
      hpFill.style.width = `${Math.round(frac * 100)}%`;
      hpFill.style.background = frac > 0.5 ? '#2ec4b6' : frac > 0.25 ? '#f5a623' : '#ff5a3c';
      hpNum.textContent = String(Math.ceil(Math.max(0, hp)));
    },
    setAmmo(mag, reserve, empty) {
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammoBox.classList.toggle('empty', !!empty);
    },
    setTimer(seconds, planted) {
      const s = Math.max(0, Math.ceil(seconds));
      timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      timerEl.classList.toggle('urgent', s <= 10);
      timerEl.classList.toggle('planted', !!planted);
    },
    setScore(vanguard, warden, round) {
      scoreEl.textContent = `${vanguard} — ${warden}`;
      roundLabel.textContent = `ROUND ${round}`;
    },
    setMoney(money) {
      moneyEl.textContent = `$${money}`;
      buyMoney.textContent = `$${money}`;
      for (const row of buyItems.children) {
        const item = SHOP.find((s) => s.id === row.dataset.id);
        row.classList.toggle('cant', money < item.price);
      }
    },
    setAlive(vanguard, warden) {
      aliveEl.innerHTML = `<span class="team-van">VAN ${vanguard}</span> · <span class="team-war">WAR ${warden}</span>`;
    },
    setWeapon(id, grenades) {
      for (const div of weaponSlots.children) div.classList.toggle('active', div.id === `slot-${id}`);
      grenadeCount.textContent = `◉ ${grenades}`;
    },
    setOwned(owned) {
      for (const row of buyItems.children) {
        const ownedItem = owned[row.dataset.id];
        row.classList.toggle('owned', !!ownedItem);
        if (ownedItem) row.querySelector('.buy-price').textContent = 'OWNED';
      }
    },
    crosshairSpread(px) {
      crosshair.style.setProperty('--spread', `${px.toFixed(1)}px`);
    },
    hitMarker(kill) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', !!kill);
      hitTimer = kill ? 0.22 : 0.12;
      setTimeout(() => hitmarker.classList.remove('on'), kill ? 220 : 120);
    },
    killFeed(killer, victim, headshot, killerTeam) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      const kc = killerTeam === 'vanguard' ? 'team-van' : 'team-war';
      line.innerHTML = `<span class="${kc}">${killer}</span> ${headshot ? '◎' : '×'} <span>${victim}</span>`;
      feedEl.prepend(line);
      while (feedEl.children.length > 5) feedEl.removeChild(feedEl.lastChild);
      setTimeout(() => line.classList.add('fade'), 4200);
    },
    banner(title, sub, ms = 2600) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub || '';
      bannerEl.hidden = false;
      bannerTimer = ms;
      setTimeout(() => { bannerEl.hidden = true; }, ms);
    },
    clearBanner() {
      bannerEl.hidden = true;
    },
    plantProgress(frac, label) {
      if (frac === null) {
        plantBar.hidden = true;
        return;
      }
      plantBar.hidden = false;
      plantFill.style.width = `${Math.round(frac * 100)}%`;
      plantLabel.textContent = label || '';
    },
    damageFlash() {
      vignette.classList.add('on');
      setTimeout(() => vignette.classList.remove('on'), 180);
    },
    showBuy(open) {
      buyEl.hidden = !open;
    },
    isBuyOpen() {
      return !buyEl.hidden;
    },
    showOverlay(kind, data = {}) {
      overlay.hidden = false;
      if (kind === 'start') {
        overlayTitle.textContent = 'SABLE YARD';
        overlayCopy.textContent = 'Vanguard attacks two sites. Plant the beacon or eliminate the Wardens. Click to play.';
        playBtn.textContent = 'Click to play';
      } else if (kind === 'paused') {
        overlayTitle.textContent = 'Paused';
        overlayCopy.textContent = 'Click to resume the round.';
        playBtn.textContent = 'Resume';
      } else if (kind === 'end') {
        overlayTitle.textContent = data.title || 'Round over';
        overlayCopy.textContent = data.sub || '';
        playBtn.textContent = data.matchOver ? 'Play again' : 'Next round';
      }
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(cb) {
      playBtn.addEventListener('click', cb);
    },
  };
}
