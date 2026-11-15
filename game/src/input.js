// Keyboard and mouse. Pointer lock drives mouse look; the game also runs without it
// (screenshot modes steer the camera by script). Key presses are delivered through a
// small event queue so the fixed-step loop, not the DOM, decides what they do.
export function createInput(domElement, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    aiming: false,
    lookX: 0,
    lookY: 0,
  };
  const pressed = [];
  let locked = false;

  function onKeyDown(event) {
    if (event.repeat) return;
    state.keys.add(event.code);
    pressed.push(event.code);
    if (event.code === 'Space') event.preventDefault();
  }
  function onKeyUp(event) {
    state.keys.delete(event.code);
  }
  function onMouseMove(event) {
    if (!locked) return;
    state.lookX += event.movementX || 0;
    state.lookY += event.movementY || 0;
  }
  function onMouseDown(event) {
    if (!locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  }
  function onMouseUp(event) {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  }
  function onLock() {
    locked = document.pointerLockElement === domElement;
    onLockChange(locked);
  }
  function onContextMenu(event) {
    event.preventDefault();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLock);
  domElement.addEventListener('contextmenu', onContextMenu);

  return {
    state,
    takeLook() {
      const look = { x: state.lookX, y: state.lookY };
      state.lookX = 0;
      state.lookY = 0;
      return look;
    },
    takePressed() {
      return pressed.splice(0, pressed.length);
    },
    requestLock() {
      domElement.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    isLocked() {
      return locked;
    },
  };
}
