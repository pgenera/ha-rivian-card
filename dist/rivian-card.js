/*
 * rivian-card: overhead vehicle state card for the home-assistant-rivian integration.
 *
 * A JavaScript port of the picture-elements YAML in src/custom-elements, with the
 * vehicle picture taken from the integration's image entities (matching the car's
 * real paint and wheels) instead of a hard-coded colour PNG.
 *
 *   type: custom:rivian-card
 *   prefix: r1s                       # entity prefix (binary_sensor.<prefix>_door_front_left, ...)
 *   model: r1s                        # r1s | r1t: picks the overlay set
 *   image: image.sasquatch_overhead   # _dark/_light suffix chosen from the theme; a full entity id or URL also works
 *   assets: /local/rivian-card/images # where the overlay images are served from
 *   lock_overlay: false               # hide the red unlocked glow/outline (the lock status still shows)
 */

const VERSION = "0.2.3";

const OVERLAYS = {
  common: [
    { entity: "front_trunk", glow: "top", svg: "trunk" },
    { entity: "door_front_left", glow: "left", svg: "driver-door" },
    { entity: "door_front_right", glow: "right", svg: "passenger-door" },
    { entity: "door_rear_left", glow: "left", svg: "rear-left-door" },
    { entity: "door_rear_right", glow: "right", svg: "rear-right-door" },
    { entity: "window_front_left", glow: "left", svg: "driver-window" },
    { entity: "window_front_right", glow: "right", svg: "passenger-window" },
    { entity: "window_rear_left", glow: "left", svg: "rear-left-window" },
    { entity: "window_rear_right", glow: "right", svg: "rear-right-window" },
    { entity: ["charger_connection", "charging_status"], svg: "charger-door" },
    { entity: "locked_state", glow: "all", svg: "lock", lock: true },
  ],
  r1s: [{ entity: "liftgate", glow: "bottom", svg: "liftgate" }],
  r1t: [
    { entity: "gear_tunnel_left", glow: "left", svg: "tunnel" },
    { entity: "gear_tunnel_right", glow: "right", svg: "tunnel" },
    { entity: "tailgate", glow: "bottom", svg: "tailgate" },
    { entity: "tonneau", glow: "bottom", svg: "bed" },
  ],
};

// The upstream outline SVGs are drawn ~4.5% smaller than the Rivian overhead render; scale
// them (about the car's centre) so the outlines sit on the body edge instead of inside it.
const OVERLAY_FIT = { r1s: 1.045, r1t: 1 };

const STYLE = `
  ha-card { overflow: hidden; }
  .stage { position: relative; cursor: pointer; }
  .car { display: block; width: 40%; margin: 4% auto 0; aspect-ratio: 516 / 1173; object-fit: contain; }
  .overlay {
    position: absolute; left: 0; top: 50%; width: 100%;
    transform: translateY(-50%) scale(var(--overlay-scale, 1));
    transform-origin: 50% 49.25%; pointer-events: none;
  }
  .slot {
    position: absolute; transform: translate(-50%, -50%);
    display: flex; flex-direction: column; align-items: center;
    cursor: pointer; text-align: center; line-height: 1.3;
    font-size: 14px; color: var(--primary-text-color);
  }
  .slot[hidden] { display: none; }
  .slot ha-state-icon { --mdc-icon-size: 28px; margin-bottom: 2px; }
  .slot .sub { color: var(--secondary-text-color); font-size: 12px; }
  #lock { top: 20%; left: 20%; }
  #location { top: 20%; left: 80%; }
  #battery { top: 79%; left: 20%; }
  #odometer { top: 79%; left: 80%; }
  #wiper { top: 28%; left: 50%; }
  #lock.unlocked ha-state-icon, #wiper ha-state-icon { color: var(--error-color); }
  #lock.locked ha-state-icon { color: var(--success-color, var(--state-icon-color)); }
  .bar { width: 64px; height: 4px; border-radius: 2px; margin-top: 4px; background: var(--divider-color); overflow: hidden; }
  .bar > div { height: 100%; background: var(--success-color); }
  .bar.low > div { background: var(--warning-color); }
  #battery.charging ha-state-icon { color: var(--success-color); animation: pulse 2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.35; } }
`;

class RivianCard extends HTMLElement {
  setConfig(config) {
    if (!config.prefix) throw new Error("prefix is required (e.g. r1s)");
    const model = (config.model || "r1s").toLowerCase();
    if (!OVERLAYS[model]) throw new Error(`unknown model ${model}`);
    this._config = { assets: "/local/rivian-card/images", ...config, model };
    this._built = false;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 7;
  }

  getGridOptions() {
    return { columns: 6, min_columns: 4, rows: "auto" };
  }

  static getStubConfig() {
    return { prefix: "r1s", model: "r1s" };
  }

  _id(domain, key) {
    return `${domain}.${this._config.prefix}_${key}`;
  }

  _state(id) {
    return this._hass.states[id];
  }

  _on(key) {
    return this._state(this._id("binary_sensor", key))?.state === "on";
  }

  _build() {
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <ha-card>
        <div class="stage">
          <img class="car" alt="">
          <div class="overlays"></div>
          <div class="slot" id="lock"><ha-state-icon></ha-state-icon><span class="label"></span></div>
          <div class="slot" id="location"><ha-state-icon></ha-state-icon><span class="label"></span></div>
          <div class="slot" id="battery">
            <ha-state-icon></ha-state-icon><span class="label"></span><span class="sub"></span>
            <div class="bar"><div></div></div>
          </div>
          <div class="slot" id="odometer"><ha-state-icon></ha-state-icon><span class="label"></span></div>
          <div class="slot" id="wiper" hidden><ha-state-icon></ha-state-icon><span class="sub">Washer fluid</span></div>
        </div>
      </ha-card>`;
    this._el = (sel) => root.querySelector(sel);
    const clicks = {
      ".car": () => this._id("binary_sensor", "locked_state"),
      "#lock": () => this._id("binary_sensor", "locked_state"),
      "#location": () => this._config.tracker || this._id("device_tracker", "location"),
      "#battery": () => this._id("sensor", "battery_state_of_charge"),
      "#odometer": () => this._id("sensor", "odometer"),
      "#wiper": () => this._id("binary_sensor", "wiper_fluid_level"),
    };
    for (const [sel, entity] of Object.entries(clicks)) {
      this._el(sel).addEventListener("click", (ev) => {
        ev.stopPropagation();
        this._moreInfo(entity());
      });
    }
    this._overlayKey = null;
    this._built = true;
  }

  _moreInfo(entityId) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })
    );
  }

  _carPicture() {
    const image = this._config.image;
    if (!image) return null;
    if (image.includes("/")) return image;
    const theme = this._hass.themes?.darkMode ? "dark" : "light";
    const candidates = image.match(/_(dark|light)$/) ? [image] : [`${image}_${theme}`, image];
    for (const id of candidates) {
      const pic = this._state(id)?.attributes.entity_picture;
      if (pic) return pic;
    }
    return null;
  }

  _format(stateObj, round) {
    if (!stateObj) return "";
    const num = Number(stateObj.state);
    // formatEntityState re-applies the entity's display precision, so whole numbers are formatted here.
    if (round && Number.isFinite(num)) {
      const unit = stateObj.attributes.unit_of_measurement || "";
      const value = Math.round(num).toLocaleString(this._hass.locale?.language);
      return unit === "%" ? `${value}%` : `${value} ${unit}`.trim();
    }
    return this._hass.formatEntityState ? this._hass.formatEntityState(stateObj) : stateObj.state;
  }

  _slot(sel, stateObj, label, icon) {
    const slot = this._el(sel);
    const stateIcon = slot.querySelector("ha-state-icon");
    stateIcon.hass = this._hass;
    stateIcon.stateObj = stateObj;
    stateIcon.icon = icon;
    if (label !== undefined) slot.querySelector(".label").textContent = label;
    return slot;
  }

  _render() {
    if (!this._config || !this._hass) return;
    if (!this._built) this._build();
    const assets = this._config.assets;
    const model = this._config.model;
    this._el(".stage").style.setProperty("--overlay-scale", this._config.overlay_scale ?? OVERLAY_FIT[model]);

    const car = this._el(".car");
    const picture = this._carPicture() || `${assets}/${model}/overhead/dark/${model}-launch-green.png`;
    if (car.getAttribute("src") !== picture) car.setAttribute("src", picture);

    // Glows are shared between closures on the same side; draw each once, under the outlines.
    const glows = new Set();
    const outlines = [];
    for (const o of [...OVERLAYS.common, ...OVERLAYS[model]]) {
      const keys = Array.isArray(o.entity) ? o.entity : [o.entity];
      if (o.lock && this._config.lock_overlay === false) continue;
      if (!keys.some((k) => this._on(k))) continue;
      if (o.glow) glows.add(`${model}-${o.glow}.png`);
      outlines.push(`${model}-${o.svg}.svg`);
    }
    const files = [...glows, ...outlines];
    const key = files.join(",");
    if (key !== this._overlayKey) {
      this._overlayKey = key;
      this._el(".overlays").innerHTML = files
        .map((f) => `<img class="overlay" alt="" src="${assets}/${model}/${f}">`)
        .join("");
    }

    const lock = this._state(this._id("binary_sensor", "locked_state"));
    const lockSlot = this._slot("#lock", lock, lock ? (lock.state === "on" ? "Unlocked" : "Locked") : "");
    lockSlot.classList.toggle("unlocked", lock?.state === "on");
    lockSlot.classList.toggle("locked", lock?.state === "off");

    const tracker = this._state(this._config.tracker || this._id("device_tracker", "location"));
    this._slot("#location", tracker, this._format(tracker));

    const soc = this._state(this._id("sensor", "battery_state_of_charge"));
    const range = this._state(this._id("sensor", "estimated_vehicle_range"));
    const charging = this._on("charging_status");
    const plugged = this._on("charger_connection");
    const remaining = this._state(this._id("sensor", "charging_time_remaining"));
    const battery = this._slot(
      "#battery",
      soc,
      this._format(soc, true),
      charging ? "mdi:battery-charging" : plugged ? "mdi:power-plug" : undefined
    );
    battery.classList.toggle("charging", charging);
    const sub = [this._format(range, true)];
    if (charging && remaining && Number(remaining.state) > 0) sub.push(this._format(remaining) + " left");
    battery.querySelector(".sub").textContent = sub.filter(Boolean).join(" · ");
    const pct = Math.max(0, Math.min(100, Number(soc?.state) || 0));
    battery.querySelector(".bar > div").style.width = `${pct}%`;
    battery.querySelector(".bar").classList.toggle("low", pct < 20);

    const odo = this._state(this._id("sensor", "odometer"));
    this._slot("#odometer", odo, this._format(odo, true));

    const wiper = this._state(this._id("binary_sensor", "wiper_fluid_level"));
    this._slot("#wiper", wiper).hidden = wiper?.state !== "on";
  }
}

customElements.define("rivian-card", RivianCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "rivian-card",
  name: "Rivian Card",
  description: "Overhead Rivian vehicle state: closures, lock, location, charge and odometer.",
});
console.info(`%c RIVIAN-CARD %c ${VERSION} `, "color: white; background: #1c5c3c", "");
