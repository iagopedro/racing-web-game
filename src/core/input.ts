import type { DriveInput } from './physics';

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  gamepadConnected = false;
  private previousButtons = new Set<number>();
  private touch = new Set<string>();
  private actionMap: Record<number, string> = { 0: 'KeyE', 2: 'KeyC', 3: 'KeyR', 9: 'Escape' };

  constructor() {
    window.addEventListener('keydown', event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
      if (!event.repeat) this.pressed.add(event.code);
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', event => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.clear());
  }

  clear(): void { this.keys.clear(); this.touch.clear(); this.pressed.clear(); }
  consume(code: string): boolean { return this.pressed.delete(code); }
  action(code: string): void { this.pressed.add(code); }
  setTouch(code: string, down: boolean): void { down ? this.touch.add(code) : this.touch.delete(code); }

  sample(): DriveInput {
    const held = (code: string) => this.keys.has(code) || this.touch.has(code);
    let throttle = Number(held('KeyW') || held('ArrowUp')) - Number(held('KeyS') || held('ArrowDown'));
    let steer = Number(held('KeyA') || held('ArrowLeft')) - Number(held('KeyD') || held('ArrowRight'));
    let brake = 0;
    let handbrake = held('Space');
    const gamepad = Array.from(navigator.getGamepads?.() ?? []).find(pad => pad?.connected);
    this.gamepadConnected = Boolean(gamepad);
    if (gamepad) {
      if (Math.abs(gamepad.axes[0]) > 0.12) steer = -gamepad.axes[0];
      throttle += (gamepad.buttons[7]?.value ?? 0) - (gamepad.buttons[6]?.value ?? 0);
      handbrake ||= gamepad.buttons[1]?.pressed ?? false;
      brake = gamepad.buttons[4]?.value ?? 0;
      for (const [button, code] of Object.entries(this.actionMap)) {
        const index = Number(button);
        if (gamepad.buttons[index]?.pressed) {
          if (!this.previousButtons.has(index)) this.pressed.add(code);
          this.previousButtons.add(index);
        } else this.previousButtons.delete(index);
      }
    }
    return { throttle: Math.max(-1, Math.min(1, throttle)), steer: Math.max(-1, Math.min(1, steer)), brake, handbrake };
  }
}