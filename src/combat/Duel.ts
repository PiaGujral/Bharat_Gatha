import * as THREE from 'three';
import { Rng } from '../core/Rng';
import { audio } from '../core/Audio';
import { stoneMaterial } from '../world/Materials';
import { buildPerson } from '../world/World';
import type { World } from '../world/World';
import type { ArrowTarget } from './Combat';

/**
 * Sparring grounds: the one place on the island where a person will fight you.
 *
 * The shades out in the haze are faceless and want you gone. These are the
 * opposite — named teachers of named living traditions, standing at an akhara,
 * who will take a bout if you ask and stop the moment it is decided. The
 * island's other people stay what they have always been: never targets. An
 * arrow that reaches a villager still clatters to the ground and they still
 * tell you to mind your aim. You have to *ask* for this fight, and the asking
 * is the whole difference.
 *
 * A bout is best-of-stamina rather than to the death. Land enough clean hits
 * and your opponent yields, bows, and tells you what their tradition is for.
 * Lose and you are the one who yields: you lose nothing but the bout, and they
 * tell you what you did wrong. Nobody on this island dies for a lesson.
 *
 * How they fight:
 *  - **Close.** Inside sword reach they circle, feint and cut, with a readable
 *    wind-up — a fight you cannot read is a fight you cannot learn from.
 *  - **Far.** Pushed to a distance they put up their bow and loose at you,
 *    leading the shot, so backing away is a choice rather than an escape.
 *  - **Between.** They close the gap, because standing still is how you lose.
 */

const STAMINA = 6;
/** How close they need to be to cut you. */
const REACH = 2.9;
/** Below this they will not bother with the bow. */
const BOW_MIN = 7;
const BOW_MAX = 26;
const ARROW_SPEED = 42;
const WALK = 3.4;
const CIRCLE = 2.2;
const WINDUP = 0.52;
const RECOVER = 0.75;
const DRAW = 0.9;
/** How far you can wander before they call the bout off. */
const LEASH = 46;
const ENGAGE = 5.5;

type Phase = 'waiting' | 'circle' | 'close' | 'windup' | 'recover' | 'draw' | 'stagger' | 'yielded' | 'won';

/** A living martial tradition, and what a bout with its teacher is meant to leave you with. */
export interface Tradition {
  id: string;
  /** What the teacher is called. */
  teacher: string;
  /** The art itself. */
  art: string;
  /** Where it is from and roughly when it is first attested. */
  home: string;
  /** Said when they yield to you. */
  taught: string;
  /** Said when you yield to them. */
  rebuke: string;
  robe: number;
}

export const TRADITIONS: readonly Tradition[] = [
  {
    id: 'kalari',
    teacher: 'Unnidanam the Gurukkal',
    art: 'Kalarippayattu',
    home: 'Kerala — attested in Malayalam ballads from the 12th century, likely older',
    taught:
      'You fought with your feet, not your arms. That is the whole of it. We train the chuvadu — the step — for a year before anyone is given a blade, because a cut is only ever as good as the ground you make it from.',
    rebuke:
      'You reached. A man who reaches has already given you his balance; you only have to wait for it. Watch my feet next time, not my hands.',
    robe: 0xb8452f,
  },
  {
    id: 'silambam',
    teacher: 'Ponnuthayi of the Staff',
    art: 'Silambam',
    home: 'Tamilakam — the Sangam poems name staff-fighters by the 2nd century CE',
    taught:
      'Good. You kept moving. The staff is only a circle you draw around yourself, and the circle is what keeps you — not the wood. Our poets wrote of this before they wrote of kings.',
    rebuke:
      'You stood still, and a still target is just a post. The circle is the weapon. Walk it.',
    robe: 0x2f6b56,
  },
  {
    id: 'gatka',
    teacher: 'Jarnail Singh',
    art: 'Gatka',
    home: 'Punjab — the martial practice of the Sikh gurus, formalised in the 17th century',
    taught:
      'You did not flinch at the noise. Half of this art is rhythm — we train to the beat of a drum because a man who moves in time does not panic. The sword follows the tempo, never the fear.',
    rebuke:
      'You fought in bursts and then stopped to think. Find a tempo and keep it, even when you are losing. Especially then.',
    robe: 0xd9a441,
  },
  {
    id: 'thangta',
    teacher: 'Ibemhal of Kangleipak',
    art: 'Thang-Ta',
    home: 'Manipur — thang, the sword; ta, the spear. Older than the written chronicles that record it',
    taught:
      'You watched the whole of me and not just the blade. That is rare. The sword is the arm and the arm is the body and the body is the breath; cut at any one of them and you have cut at all four.',
    rebuke:
      'You watched my sword. My sword is the last thing to move and the last thing you should look at.',
    robe: 0x6b4b9a,
  },
  {
    id: 'dhanurveda',
    teacher: 'Acharya Vishalaksha',
    art: 'Dhanurveda',
    home: 'The archery treatise, a subject of the Vedas, systematised in the Agni Purana',
    taught:
      'You loosed when you were still, not when you were ready. Those are different moments and the second one is the one that matters. The treatise gives four stances; you found one of them without being told.',
    rebuke:
      'You loosed while moving, and an arrow does not care how brave you were. Set your feet. Then draw.',
    robe: 0x3f6bbf,
  },
  {
    id: 'malla',
    teacher: 'Bhimrao the Jyeshthi',
    art: 'Malla-yuddha',
    home: 'The wrestling of the Malla Purana, written down in Gujarat in the 13th century',
    taught:
      'You closed the distance instead of trading cuts at the edge of it. A wrestler would say you fought like one of us. The Malla Purana spends more pages on diet and sleep than on throws, and it is right to.',
    rebuke:
      'You stayed at the end of your blade where it is safe. Safe is not the same as winning.',
    robe: 0x8a6b4a,
  },
];

interface Arrow {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
}

export interface DuelEvents {
  /** Their arrow or blade landed. */
  onPlayerHit?: () => void;
  /** The bout ended. `won` is from the player's point of view. */
  onEnded?: (duelist: Duelist, won: boolean) => void;
  /** The player walked too far away and the teacher called the bout off. */
  onWalkedAway?: (duelist: Duelist) => void;
  /** Somebody landed a hit; `theirs` tells you whose stamina moved. */
  onScore?: (duelist: Duelist) => void;
}

/** Where on a standing person an arrow is aimed, above their feet. */
const CHEST = 1.15;

export class Duelist implements ArrowTarget {
  readonly position = new THREE.Vector3();
  /** The same place, at chest height: what the bow and the blade are aimed at. */
  readonly center = new THREE.Vector3();
  readonly tradition: Tradition;
  readonly zoneId: string;
  readonly group = new THREE.Group();

  stamina = STAMINA;
  /** The player's remaining stamina in this bout, kept beside theirs. */
  phase: Phase = 'waiting';
  yaw = 0;

  private timer = 0;
  private circleDir: 1 | -1 = 1;
  private readonly home = new THREE.Vector3();
  private readonly mesh: THREE.Mesh;
  private flash = 0;
  private readonly mat: THREE.MeshStandardMaterial;

  constructor(tradition: Tradition, zoneId: string, x: number, y: number, z: number, yaw: number, rng: Rng) {
    this.tradition = tradition;
    this.zoneId = zoneId;
    this.position.set(x, y, z);
    this.center.set(x, y + CHEST, z);
    this.home.set(x, y, z);
    this.yaw = yaw;
    this.circleDir = rng.bool() ? 1 : -1;

    // Their own copy of the stone material. The hit flash below sets `emissive`, and stoneMaterial() is shared by
    // every building on the island, so flashing the shared one lit up all the monuments at once. Keep the shared
    // shader hook so they are weathered like everyone else (and reuse its compiled program).
    const shared = stoneMaterial();
    this.mat = shared.clone();
    this.mat.onBeforeCompile = shared.onBeforeCompile;
    this.mesh = new THREE.Mesh(buildPerson(tradition.robe, rng), this.mat);
    this.mesh.castShadow = true;
    this.group.add(this.mesh);
    this.group.position.copy(this.position);
    this.group.rotation.y = yaw;
  }

  /** ArrowTarget: how big a thing an arrow has to hit. */
  get radius(): number {
    return 0.95;
  }

  get fighting(): boolean {
    return this.phase !== 'waiting' && this.phase !== 'yielded' && this.phase !== 'won';
  }

  /** Free to take a bout: not in one, and not still resting after the last. */
  get ready(): boolean {
    return this.phase === 'waiting';
  }

  /** ArrowTarget: the player's arrow or blade found them. */
  takeHit(amount: number, _from: THREE.Vector3): boolean {
    if (!this.fighting) return false;
    this.stamina = Math.max(0, this.stamina - amount);
    this.flash = 0.2;
    // A hit breaks whatever they were doing, which is what makes a bout winnable.
    this.phase = 'stagger';
    this.timer = 0.42;
    audio.shadeHit();
    return true;
  }

  begin(): void {
    this.stamina = STAMINA;
    this.phase = 'circle';
    this.timer = 0.8;
  }

  yield_(): void {
    this.phase = 'yielded';
    this.timer = 0;
  }

  win(): void {
    this.phase = 'won';
    this.timer = 0;
  }

  reset(): void {
    this.phase = 'waiting';
    this.stamina = STAMINA;
    this.position.copy(this.home);
    this.center.set(this.home.x, this.home.y + CHEST, this.home.z);
    this.group.position.copy(this.position);
  }

  /**
   * One frame of the bout. Returns what they did this frame, so the manager can
   * turn it into damage, arrows and sound without this class knowing about any
   * of them.
   */
  think(dt: number, player: THREE.Vector3, terrain: World['terrain']): 'cut' | 'loose' | null {
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt);
      this.mat.emissive?.setScalar(this.flash * 1.4);
    }
    if (!this.fighting) {
      this.face(player, dt);
      return null;
    }

    const dx = player.x - this.position.x;
    const dz = player.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    this.timer -= dt;
    let did: 'cut' | 'loose' | null = null;

    switch (this.phase) {
      case 'stagger':
        if (this.timer <= 0) this.phase = 'circle';
        break;

      case 'circle': {
        // Keep sword distance and move around them, so a bout is a dance and
        // not two people standing in each other's faces.
        const want = REACH * 0.85;
        const push = dist > want ? 1 : -1;
        this.step(dt, (dx / (dist || 1)) * push * WALK, (dz / (dist || 1)) * push * WALK, terrain);
        this.step(dt, (-dz / (dist || 1)) * this.circleDir * CIRCLE, (dx / (dist || 1)) * this.circleDir * CIRCLE, terrain);
        if (this.timer <= 0) {
          if (dist <= REACH) {
            this.phase = 'windup';
            this.timer = WINDUP;
            audio.swing();
          } else if (dist >= BOW_MIN && dist <= BOW_MAX) {
            this.phase = 'draw';
            this.timer = DRAW;
            audio.bowDraw();
          } else {
            this.phase = 'close';
            this.timer = 0.9;
          }
        }
        break;
      }

      case 'close': {
        this.step(dt, (dx / (dist || 1)) * WALK * 1.3, (dz / (dist || 1)) * WALK * 1.3, terrain);
        if (dist <= REACH || this.timer <= 0) {
          this.phase = 'circle';
          this.timer = 0.3;
        }
        break;
      }

      case 'windup':
        if (this.timer <= 0) {
          // The cut lands only if they are still in reach — step back in time
          // and it misses, which is the whole skill of it.
          if (dist <= REACH + 0.4) did = 'cut';
          this.phase = 'recover';
          this.timer = RECOVER;
        }
        break;

      case 'recover':
        if (this.timer <= 0) {
          this.phase = 'circle';
          this.timer = 0.35 + Math.random() * 0.5;
          this.circleDir = Math.random() < 0.5 ? 1 : -1;
        }
        break;

      case 'draw':
        if (this.timer <= 0) {
          if (dist >= BOW_MIN * 0.8) did = 'loose';
          this.phase = 'circle';
          this.timer = 0.6;
        }
        break;

      default:
        break;
    }

    this.face(player, dt);
    return did;
  }

  /** How far the player has strayed from where this bout started. */
  distanceFromHome(p: THREE.Vector3): number {
    return Math.hypot(p.x - this.home.x, p.z - this.home.z);
  }

  private face(player: THREE.Vector3, dt: number): void {
    const want = Math.atan2(-(player.x - this.position.x), -(player.z - this.position.z));
    let diff = want - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += Math.max(-dt * 6, Math.min(dt * 6, diff));
    this.group.rotation.y = this.yaw;
  }

  private step(dt: number, vx: number, vz: number, terrain: World['terrain']): void {
    const nx = this.position.x + vx * dt;
    const nz = this.position.z + vz * dt;
    // Stay on the sparring ground and out of the sea.
    if (Math.hypot(nx - this.home.x, nz - this.home.z) > LEASH * 0.5) return;
    const y = terrain.heightAt(nx, nz);
    if (y <= 0.4) return;
    this.position.set(nx, y, nz);
    this.center.set(nx, y + CHEST, nz);
    this.group.position.copy(this.position);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.mat.dispose();
  }
}

export class Duels {
  readonly group = new THREE.Group();
  readonly duelists: Duelist[] = [];

  /** The bout in progress, if any. */
  active: Duelist | null = null;
  /** The player's stamina in the current bout. */
  playerStamina = STAMINA;

  private readonly arrows: Arrow[] = [];
  /** Their stamina as of last frame, to notice a hit landed from anywhere. */
  private lastStamina = STAMINA;
  private readonly arrowGeo: THREE.BufferGeometry;
  private readonly arrowMat: THREE.MeshStandardMaterial;
  private readonly v = new THREE.Vector3();
  /** The pending "ready again" timers, so dispose() can cancel them. */
  private readonly restTimers = new Set<number>();

  constructor(
    private readonly world: World,
    private readonly events: DuelEvents = {},
  ) {
    this.group.name = 'duels';
    this.arrowGeo = new THREE.CylinderGeometry(0.035, 0.035, 1.1, 5);
    this.arrowGeo.rotateX(Math.PI / 2);
    this.arrowMat = stoneMaterial();
    this.world.group.add(this.group);
  }

  /**
   * Put one teacher in each of the first regions that has somewhere sensible to
   * stand. A sparring ground wants flat, dry, open land near where people are.
   */
  spawn(seed: string, zoneIds: readonly string[]): void {
    const rng = new Rng(`${seed}:duels`);
    TRADITIONS.forEach((tradition, i) => {
      const zoneId = zoneIds[i % zoneIds.length];
      if (!zoneId) return;
      const anchor = this.world.landmarks.find((l) => l.zoneId === zoneId) ?? this.world.landmarks[i];
      if (!anchor) return;
      const spot = this.findGround(anchor.position.x, anchor.position.z, anchor.radius + 12, rng);
      if (!spot) return;
      const d = new Duelist(tradition, zoneId, spot.x, spot.y, spot.z, rng.range(0, Math.PI * 2), rng);
      this.duelists.push(d);
      this.group.add(d.group);
    });
  }

  private findGround(cx: number, cz: number, radius: number, rng: Rng): THREE.Vector3 | null {
    for (let tries = 0; tries < 40; tries++) {
      const a = rng.range(0, Math.PI * 2);
      const r = radius + rng.range(0, 14);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const y = this.world.terrain.heightAt(x, z);
      if (y <= 1) continue;
      if (this.world.collision.resolve(x, y, z, 1.4, 1.9, 0.68).blocked) continue;
      return new THREE.Vector3(x, y, z);
    }
    return null;
  }

  /** The teacher close enough to be spoken to, for the interact prompt. Teachers still resting after a bout are skipped. */
  nearest(point: THREE.Vector3, maxDistance = ENGAGE): Duelist | null {
    let best: Duelist | null = null;
    let bestD = maxDistance;
    for (const d of this.duelists) {
      if (!d.ready) continue;
      const dist = Math.hypot(d.position.x - point.x, d.position.z - point.z);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }

  challenge(d: Duelist): void {
    // Not while they are resting: the delayed reset() from the last bout would
    // fire mid-bout, put them back to 'waiting', and leave a bout nobody can win.
    if (this.active || !d.ready) return;
    this.active = d;
    this.playerStamina = STAMINA;
    this.lastStamina = STAMINA;
    d.begin();
    audio.conch();
  }

  /** End the bout without a result — walking away, or being pulled elsewhere. */
  abandon(): void {
    if (!this.active) return;
    this.active.reset();
    this.active = null;
    this.clearArrows();
  }

  update(dt: number, player: THREE.Vector3, paused: boolean): void {
    if (paused) return;
    this.updateArrows(dt, player);

    const d = this.active;
    if (!d) return;

    // The player's blade and arrows reach a teacher through the combat
    // registry, which calls `takeHit` on them directly — this manager is never
    // told. So watch the score instead of waiting to be informed, which also
    // means any future way of hurting them is picked up for free.
    if (d.stamina !== this.lastStamina) {
      this.lastStamina = d.stamina;
      this.events.onScore?.(d);
      if (d.stamina <= 0) {
        this.finish(true);
        return;
      }
    }

    // Walk far enough away and the bout is off — they are not going to chase
    // you across a region for it.
    if (d.distanceFromHome(player) > LEASH) {
      this.abandon();
      this.events.onWalkedAway?.(d);
      return;
    }

    const did = d.think(dt, player, this.world.terrain);
    if (did === 'cut') {
      const dist = Math.hypot(player.x - d.position.x, player.z - d.position.z);
      if (dist <= REACH + 0.4) this.hitPlayer();
      else audio.swing();
    } else if (did === 'loose') {
      this.loose(d, player);
    }
  }

  private loose(d: Duelist, player: THREE.Vector3): void {
    const mesh = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    const from = new THREE.Vector3(d.position.x, d.position.y + 1.45, d.position.z);
    // Lead the shot a little, so standing still is not safe and running is not
    // automatically safe either.
    const target = new THREE.Vector3(player.x, player.y + 1.0, player.z);
    const dir = target.clone().sub(from);
    const flight = dir.length() / ARROW_SPEED;
    dir.y += 4.9 * flight * flight;
    dir.normalize();
    mesh.position.copy(from);
    mesh.lookAt(target);
    this.group.add(mesh);
    this.arrows.push({ mesh, pos: from.clone(), vel: dir.multiplyScalar(ARROW_SPEED), life: 4 });
    audio.bowRelease();
  }

  private updateArrows(dt: number, player: THREE.Vector3): void {
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i] as Arrow;
      a.life -= dt;
      a.vel.y -= 9.8 * dt;
      a.pos.addScaledVector(a.vel, dt);
      a.mesh.position.copy(a.pos);
      a.mesh.lookAt(this.v.copy(a.pos).add(a.vel));

      const near = Math.hypot(a.pos.x - player.x, a.pos.z - player.z) < 0.8 && Math.abs(a.pos.y - (player.y + 1.0)) < 1.2;
      const grounded = a.pos.y <= this.world.terrain.heightAt(a.pos.x, a.pos.z);
      if (near) {
        this.hitPlayer();
        this.drop(i);
      } else if (grounded || a.life <= 0) {
        this.drop(i);
      }
    }
  }

  private drop(i: number): void {
    const a = this.arrows[i] as Arrow;
    this.group.remove(a.mesh);
    this.arrows.splice(i, 1);
  }

  private clearArrows(): void {
    for (let i = this.arrows.length - 1; i >= 0; i--) this.drop(i);
  }

  private hitPlayer(): void {
    if (!this.active) return;
    this.playerStamina = Math.max(0, this.playerStamina - 1);
    audio.hurt();
    this.events.onPlayerHit?.();
    this.events.onScore?.(this.active);
    if (this.playerStamina <= 0) this.finish(false);
  }

  private finish(won: boolean): void {
    const d = this.active;
    if (!d) return;
    this.clearArrows();
    if (won) d.yield_();
    else d.win();
    this.active = null;
    audio.conch();
    this.events.onEnded?.(d, won);
    // They are ready to go again once you have had a moment with the lesson.
    const id = window.setTimeout(() => {
      this.restTimers.delete(id);
      d.reset();
    }, 9000);
    this.restTimers.add(id);
  }

  dispose(): void {
    for (const id of this.restTimers) window.clearTimeout(id);
    this.restTimers.clear();
    this.clearArrows();
    for (const d of this.duelists) d.dispose();
    this.duelists.length = 0;
    this.arrowGeo.dispose();
  }
}

export { STAMINA as DUEL_STAMINA };
