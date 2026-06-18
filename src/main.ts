import * as Phaser from 'phaser';
import './style.css';
import { BALANCE } from './gameBalance';
import { SoundCueManager } from './soundCueManager';

const GAME_WIDTH = BALANCE.world.width;
const GAME_HEIGHT = BALANCE.world.height;
const WALL_THICKNESS = BALANCE.world.wallThickness;
const GUARD_VIEW_ANGLE = Phaser.Math.DegToRad(BALANCE.guard.viewAngleDeg);
const HOUND_VIEW_ANGLE = Phaser.Math.DegToRad(BALANCE.hound.viewAngleDeg);

type ActionName =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'attack'
  | 'block'
  | 'dodge'
  | 'interact'
  | 'toggleTorch';

type Binding =
  | { type: 'keyboard'; code: string }
  | { type: 'pointer'; button: 0 | 2 };

type ControlsMap = Record<ActionName, Binding[]>;

enum PlayerState {
  Idle = 'idle',
  Attack = 'attack',
  Block = 'block',
  Dodge = 'dodge',
}

enum GuardState {
  Patrol = 'patrol',
  Suspicious = 'suspicious',
  Chase = 'chase',
  Return = 'return',
  Stunned = 'stunned',
}

enum HoundState {
  Idle = 'idle',
  Released = 'released',
  Search = 'search',
  Chase = 'chase',
  Attack = 'attack',
  Reset = 'reset',
}

const DEFAULT_BINDINGS: ControlsMap = {
  moveUp: [
    { type: 'keyboard', code: 'W' },
    { type: 'keyboard', code: 'UP' },
  ],
  moveDown: [
    { type: 'keyboard', code: 'S' },
    { type: 'keyboard', code: 'DOWN' },
  ],
  moveLeft: [
    { type: 'keyboard', code: 'A' },
    { type: 'keyboard', code: 'LEFT' },
  ],
  moveRight: [
    { type: 'keyboard', code: 'D' },
    { type: 'keyboard', code: 'RIGHT' },
  ],
  attack: [{ type: 'pointer', button: 0 }],
  block: [{ type: 'pointer', button: 2 }],
  dodge: [{ type: 'keyboard', code: 'SPACE' }],
  interact: [
    { type: 'keyboard', code: 'E' },
    { type: 'keyboard', code: 'F' },
  ],
  toggleTorch: [
    { type: 'keyboard', code: 'Q' },
    { type: 'keyboard', code: 'T' },
  ],
};

class ControlManager {
  private readonly scene: Phaser.Scene;
  private readonly keys = new Map<string, Phaser.Input.Keyboard.Key>();
  private bindings: ControlsMap;
  private pointerDown = { 0: false, 2: false };
  private previousPointerDown = { 0: false, 2: false };

  constructor(scene: Phaser.Scene, bindings: ControlsMap) {
    this.scene = scene;
    this.bindings = structuredClone(bindings);

    const codes = new Set<string>();
    Object.values(this.bindings).flat().forEach((binding) => {
      if (binding.type === 'keyboard') {
        codes.add(binding.code);
      }
    });

    if (!this.scene.input.keyboard) {
      throw new Error('Keyboard input is unavailable.');
    }

    codes.forEach((code) => {
      this.keys.set(code, this.scene.input.keyboard!.addKey(code));
    });
  }

  updatePointerState(): void {
    const pointer = this.scene.input.activePointer;
    this.pointerDown = {
      0: pointer.leftButtonDown(),
      2: pointer.rightButtonDown(),
    };
  }

  finalizeFrame(): void {
    this.previousPointerDown = { ...this.pointerDown };
  }

  isDown(action: ActionName): boolean {
    return this.bindings[action].some((binding) => {
      if (binding.type === 'pointer') {
        return this.pointerDown[binding.button];
      }

      return this.keys.get(binding.code)?.isDown ?? false;
    });
  }

  justPressed(action: ActionName): boolean {
    return this.bindings[action].some((binding) => {
      if (binding.type === 'pointer') {
        return this.pointerDown[binding.button] && !this.previousPointerDown[binding.button];
      }

      const key = this.keys.get(binding.code);
      return key ? Phaser.Input.Keyboard.JustDown(key) : false;
    });
  }

  summary(): string {
    const toLabel = (binding: Binding): string => {
      if (binding.type === 'pointer') {
        return binding.button === 0 ? 'LMB' : 'RMB';
      }

      return binding.code === 'SPACE' ? 'Space' : binding.code;
    };

    return [
      `Move ${this.bindings.moveUp.map(toLabel).join('/')} ${this.bindings.moveLeft.map(toLabel).join('/')} ${this.bindings.moveDown.map(toLabel).join('/')} ${this.bindings.moveRight.map(toLabel).join('/')}`,
      `Attack ${this.bindings.attack.map(toLabel).join('/')}`,
      `Block ${this.bindings.block.map(toLabel).join('/')}`,
      `Dodge ${this.bindings.dodge.map(toLabel).join('/')}`,
      `Interact ${this.bindings.interact.map(toLabel).join('/')}`,
      `Torch ${this.bindings.toggleTorch.map(toLabel).join('/')}`,
    ].join(' • ');
  }
}

class DungeonCrawlerScene extends Phaser.Scene {
  private controls!: ControlManager;
  private soundCues!: SoundCueManager;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private player!: Phaser.Physics.Arcade.Sprite;
  private guard!: Phaser.Physics.Arcade.Sprite;
  private hound!: Phaser.Physics.Arcade.Sprite;
  private keyPickup?: Phaser.Physics.Arcade.Sprite;
  private torchPickup?: Phaser.Physics.Arcade.Sprite;
  private lockedDoor!: Phaser.Physics.Arcade.Sprite;
  private lockedDoorCollider?: Phaser.Physics.Arcade.Collider;
  private objectiveZone!: Phaser.GameObjects.Zone;
  private playerLight!: Phaser.GameObjects.Light;
  private torchPickupLight?: Phaser.GameObjects.Light;
  private houndWarningLight!: Phaser.GameObjects.Light;
  private guardSightGraphics!: Phaser.GameObjects.Graphics;
  private houndSightGraphics!: Phaser.GameObjects.Graphics;
  private messageText!: Phaser.GameObjects.Text;
  private hudText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private controlsText!: Phaser.GameObjects.Text;
  private promptText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private floorAccent!: Phaser.GameObjects.Graphics;
  private playerState = PlayerState.Idle;
  private playerStateEndsAt = 0;
  private attackCooldownEndsAt = 0;
  private dodgeCooldownEndsAt = 0;
  private blockStartedAt = 0;
  private playerFacing = new Phaser.Math.Vector2(1, 0);
  private lastMoveDirection = new Phaser.Math.Vector2(1, 0);
  private guardFacing = new Phaser.Math.Vector2(0, -1);
  private houndFacing = new Phaser.Math.Vector2(-1, 0);
  private guardState = GuardState.Patrol;
  private guardStateUntil = 0;
  private houndState = HoundState.Idle;
  private houndStateUntil = 0;
  private guardLastSeen = new Phaser.Math.Vector2(0, 0);
  private houndLastSeen = new Phaser.Math.Vector2(0, 0);
  private guardPatrolIndex = 0;
  private wallRects: Phaser.Geom.Rectangle[] = [];
  private hasKey = false;
  private doorUnlocked = false;
  private hasTorch = false;
  private torchEquipped = false;
  private playerHealth = BALANCE.player.maxHealth;
  private playerDamageCooldownEndsAt = 0;
  private missionComplete = false;
  private currentPrompt = '';
  private messageExpiresAt = 0;
  private countdownRemainingMs = BALANCE.countdown.startMs;
  private countdownWarningStage: 'none' | 'low' | 'critical' | 'released' = 'none';
  private houndReleased = false;
  private houndHealth = BALANCE.hound.maxHealth;
  private guardNextFootstepAt = 0;
  private houndNextGrowlAt = 0;
  private houndNextBarkAt = 0;

  private readonly playerSpawn = new Phaser.Math.Vector2(BALANCE.player.spawn.x, BALANCE.player.spawn.y);
  private readonly guardSpawn = new Phaser.Math.Vector2(BALANCE.guard.spawn.x, BALANCE.guard.spawn.y);
  private readonly houndSpawn = new Phaser.Math.Vector2(BALANCE.hound.spawn.x, BALANCE.hound.spawn.y);
  private readonly houndReleaseTarget = new Phaser.Math.Vector2(
    BALANCE.hound.releaseInvestigateTarget.x,
    BALANCE.hound.releaseInvestigateTarget.y,
  );
  private readonly patrolPoints = BALANCE.guard.patrolPoints.map((point) => new Phaser.Math.Vector2(point.x, point.y));

  constructor() {
    super('dungeon-crawler');
  }

  preload(): void {
    this.createTextures();
  }

  create(): void {
    this.cameras.main.setBackgroundColor(BALANCE.world.backgroundColor);
    this.input.mouse?.disableContextMenu();
    this.controls = new ControlManager(this, DEFAULT_BINDINGS);
    this.soundCues = new SoundCueManager(this);

    this.physics.world.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.createLevel();
    this.createActors();
    this.createUi();
    this.createCollisions();
    this.setMessage('Scout report: key, torch, door — and keep the kennel clock under control.');
  }

  update(_time: number, delta: number): void {
    const now = this.time.now;
    this.controls.updatePointerState();

    if (!this.missionComplete) {
      this.updatePlayer(now, delta);
      this.updateCountdown(delta);
      this.updateInteractionPrompt();
      this.updateGuard(now, delta);
      this.updateHound(now);
      this.checkObjective();
    } else {
      this.player.setVelocity(0, 0);
      this.guard.setVelocity(0, 0);
      if (this.isHoundActive()) {
        this.hound.setVelocity(0, 0);
      }
    }

    this.updateLightsAndUi(now);
    this.drawSightCones();
    this.controls.finalizeFrame();
  }

  private createTextures(): void {
    const g = this.make.graphics({ x: 0, y: 0 });

    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 16, 16);
    g.generateTexture('pixel', 16, 16);
    g.clear();

    g.fillStyle(0x26313b, 1);
    g.fillRect(0, 0, 64, 64);
    g.fillStyle(0x202833, 1);
    for (let x = 0; x < 64; x += 16) {
      g.fillRect(x, 0, 2, 64);
    }
    for (let y = 0; y < 64; y += 16) {
      g.fillRect(0, y, 64, 2);
    }
    g.fillStyle(0x394756, 0.4);
    g.fillRect(10, 10, 12, 12);
    g.fillRect(38, 24, 10, 10);
    g.generateTexture('floor', 64, 64);
    g.clear();

    g.fillStyle(0x8ad1ff, 1);
    g.fillCircle(12, 12, 12);
    g.generateTexture('player', 24, 24);
    g.clear();

    g.fillStyle(0xc93f5b, 1);
    g.fillCircle(12, 12, 12);
    g.generateTexture('guard', 24, 24);
    g.clear();

    g.fillStyle(0xd84d54, 1);
    g.fillTriangle(12, 0, 24, 12, 12, 24);
    g.fillTriangle(12, 0, 0, 12, 12, 24);
    g.fillStyle(0xf3d9cf, 1);
    g.fillCircle(12, 13, 7);
    g.generateTexture('hound', 24, 24);
    g.clear();

    g.fillStyle(0xf2cc6b, 1);
    g.beginPath();
    g.moveTo(12, 0);
    g.lineTo(24, 12);
    g.lineTo(12, 24);
    g.lineTo(0, 12);
    g.closePath();
    g.fillPath();
    g.generateTexture('key', 24, 24);
    g.clear();

    g.fillStyle(0xf6ab55, 1);
    g.fillRect(9, 3, 6, 10);
    g.fillStyle(0x7b4d20, 1);
    g.fillRect(10, 13, 4, 11);
    g.generateTexture('torch', 24, 24);
    g.clear();

    g.fillStyle(0x6e4f2c, 1);
    g.fillRect(0, 0, 32, 64);
    g.fillStyle(0xb18b46, 1);
    g.fillRect(22, 28, 5, 8);
    g.generateTexture('door', 32, 64);
    g.destroy();
  }

  private createLevel(): void {
    this.add.tileSprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 'floor');
    this.floorAccent = this.add.graphics();
    this.floorAccent.fillStyle(0x1c2330, 0.6);
    this.floorAccent.fillRect(96, 96, 772, 56);
    this.floorAccent.fillRect(96, 488, 772, 56);
    this.floorAccent.fillStyle(0x161b26, 0.7);
    this.floorAccent.fillRect(304, 144, 224, 352);
    this.floorAccent.fillRect(600, 144, 200, 96);
    this.floorAccent.fillStyle(0x38171d, 0.55);
    this.floorAccent.fillRect(780, 64, 116, 88);

    this.walls = this.physics.add.staticGroup();
    const addWall = (x: number, y: number, width: number, height: number): void => {
      const wall = this.walls
        .create(x, y, 'pixel')
        .setOrigin(0, 0)
        .setDisplaySize(width, height)
        .setTint(0x66717f) as Phaser.Physics.Arcade.Sprite;
      wall.refreshBody();
      wall.setPipeline('Light2D');
      this.wallRects.push(new Phaser.Geom.Rectangle(x, y, width, height));
    };

    addWall(0, 0, GAME_WIDTH, WALL_THICKNESS);
    addWall(0, GAME_HEIGHT - WALL_THICKNESS, GAME_WIDTH, WALL_THICKNESS);
    addWall(0, 0, WALL_THICKNESS, GAME_HEIGHT);
    addWall(GAME_WIDTH - WALL_THICKNESS, 0, WALL_THICKNESS, GAME_HEIGHT);

    addWall(304, 144, 224, 24);
    addWall(304, 144, 24, 352);
    addWall(304, 472, 224, 24);
    addWall(504, 144, 24, 128);
    addWall(504, 336, 24, 160);

    addWall(600, 144, 200, 24);
    addWall(776, 144, 24, 120);
    addWall(600, 240, 80, 24);
    addWall(720, 240, 80, 24);

    addWall(176, 144, 24, 120);
    addWall(176, 376, 24, 120);
    addWall(176, 256, 144, 24);
    addWall(176, 360, 144, 24);
    addWall(104, 200, 72, 24);
    addWall(104, 416, 72, 24);

    this.lockedDoor = this.physics.add.sprite(516, 304, 'door').setImmovable(true).setTint(0x8e6d3d);
    const doorBody = this.lockedDoor.body as Phaser.Physics.Arcade.Body;
    doorBody.setAllowGravity(false);
    this.lockedDoor.setPipeline('Light2D');
    this.lockedDoor.setDepth(3);

    this.keyPickup = this.physics.add.sprite(700, 192, 'key').setImmovable(true);
    const keyBody = this.keyPickup.body as Phaser.Physics.Arcade.Body;
    keyBody.setAllowGravity(false);
    this.keyPickup.setPipeline('Light2D');
    this.keyPickup.setDepth(3);

    this.torchPickup = this.physics.add.sprite(BALANCE.torch.pickup.x, BALANCE.torch.pickup.y, 'torch').setImmovable(true);
    const torchBody = this.torchPickup.body as Phaser.Physics.Arcade.Body;
    torchBody.setAllowGravity(false);
    this.torchPickup.setPipeline('Light2D');
    this.torchPickup.setDepth(3);

    this.objectiveZone = this.add.zone(416, 320, 120, 120);
    this.physics.add.existing(this.objectiveZone);
    const objectiveBody = this.objectiveZone.body as Phaser.Physics.Arcade.Body;
    objectiveBody.setAllowGravity(false);
    objectiveBody.moves = false;

    this.lights.enable().setAmbientColor(BALANCE.world.ambientColor);
    this.lights.addLight(700, 192, 90, 0xf2cc6b, 1.2).setIntensity(1.2);
    this.torchPickupLight = this.lights.addLight(BALANCE.torch.pickup.x, BALANCE.torch.pickup.y, 76, 0xffb454, 0.85);
    this.houndWarningLight = this.lights.addLight(
      this.houndSpawn.x,
      this.houndSpawn.y,
      BALANCE.hound.warningLightRadius,
      0xff4d5c,
      0.2,
    );
  }

  private createActors(): void {
    this.player = this.physics.add.sprite(this.playerSpawn.x, this.playerSpawn.y, 'player');
    this.player.setCircle(12, 0, 0);
    this.player.setCollideWorldBounds(true);
    this.player.setDamping(true);
    this.player.setDrag(1400, 1400);
    this.player.setDepth(4);
    this.player.setPipeline('Light2D');

    this.guard = this.physics.add.sprite(this.guardSpawn.x, this.guardSpawn.y, 'guard');
    this.guard.setCircle(12, 0, 0);
    this.guard.setCollideWorldBounds(true);
    this.guard.setDepth(4);
    this.guard.setPipeline('Light2D');

    this.hound = this.physics.add.sprite(this.houndSpawn.x, this.houndSpawn.y, 'hound');
    this.hound.setCircle(12, 0, 0);
    this.hound.setCollideWorldBounds(true);
    this.hound.setDepth(4);
    this.hound.setPipeline('Light2D');
    this.hound.disableBody(true, true);

    this.playerLight = this.lights.addLight(
      this.player.x,
      this.player.y,
      BALANCE.player.lightRadius,
      0xe8f4ff,
      BALANCE.player.lightIntensity,
    );
    this.lights.addLight(516, 304, 72, 0xffcf80, 0.8);
  }

  private createUi(): void {
    const makeText = (x: number, y: number, size: string, color = '#f7f5e8'): Phaser.GameObjects.Text =>
      this.add
        .text(x, y, '', {
          fontFamily: 'monospace',
          fontSize: size,
          color,
          stroke: '#090a11',
          strokeThickness: 4,
        })
        .setScrollFactor(0)
        .setDepth(20);

    this.hudText = makeText(18, 16, '18px');
    this.statusText = makeText(18, 40, '16px', '#cdd6e1');
    this.controlsText = makeText(18, 594, '14px', '#cdd6e1');
    this.controlsText.setText(`Scout kit: ${this.controls.summary()}`);
    this.messageText = makeText(18, 68, '16px', '#f2cc6b');
    this.promptText = makeText(18, 566, '16px', '#8fe3ff');
    this.objectiveText = makeText(942, 16, '18px', '#ffd479').setOrigin(1, 0);
    this.guardSightGraphics = this.add.graphics().setDepth(2);
    this.houndSightGraphics = this.add.graphics().setDepth(2);
  }

  private createCollisions(): void {
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.guard, this.walls);
    this.physics.add.collider(this.hound, this.walls);
    this.lockedDoorCollider = this.physics.add.collider(this.player, this.lockedDoor);
    this.physics.add.collider(this.guard, this.lockedDoor);
    this.physics.add.collider(this.hound, this.lockedDoor);
    this.physics.add.overlap(this.player, this.guard, () => this.handleGuardContact());
    this.physics.add.overlap(this.player, this.hound, () => this.handleHoundContact());
  }

  private updatePlayer(now: number, delta: number): void {
    if (now >= this.playerStateEndsAt && this.playerState !== PlayerState.Block) {
      this.playerState = PlayerState.Idle;
    }

    const pointer = this.input.activePointer;
    const aim = new Phaser.Math.Vector2(pointer.worldX - this.player.x, pointer.worldY - this.player.y);
    if (aim.lengthSq() > 16) {
      aim.normalize();
      this.playerFacing.copy(aim);
    }

    if (this.controls.justPressed('toggleTorch')) {
      this.toggleTorch();
    }

    const moveX = Number(this.controls.isDown('moveRight')) - Number(this.controls.isDown('moveLeft'));
    const moveY = Number(this.controls.isDown('moveDown')) - Number(this.controls.isDown('moveUp'));
    const move = new Phaser.Math.Vector2(moveX, moveY);
    if (move.lengthSq() > 0) {
      move.normalize();
      this.lastMoveDirection.copy(move);
      if (this.playerState !== PlayerState.Block) {
        this.playerFacing.copy(move);
      }
    }

    if (this.controls.justPressed('attack') && now >= this.attackCooldownEndsAt && this.playerState !== PlayerState.Dodge) {
      this.playerState = PlayerState.Attack;
      this.playerStateEndsAt = now + BALANCE.player.attackDurationMs;
      this.attackCooldownEndsAt = now + BALANCE.player.attackCooldownMs;
      this.resolveAttack();
    }

    if (this.controls.justPressed('dodge') && now >= this.dodgeCooldownEndsAt) {
      this.playerState = PlayerState.Dodge;
      this.playerStateEndsAt = now + BALANCE.player.dodgeDurationMs;
      this.dodgeCooldownEndsAt = now + BALANCE.player.dodgeCooldownMs;
      const dodgeDirection = move.lengthSq() > 0 ? move.clone() : this.playerFacing.clone();
      dodgeDirection.normalize();
      this.player.setVelocity(dodgeDirection.x * BALANCE.player.dodgeSpeed, dodgeDirection.y * BALANCE.player.dodgeSpeed);
      this.player.setTint(0xb7f8ff);
      this.setMessage('Zip! Dodge window active.');
    }

    if (this.controls.isDown('block') && this.playerState !== PlayerState.Dodge) {
      if (this.playerState !== PlayerState.Block) {
        this.blockStartedAt = now;
      }
      this.playerState = PlayerState.Block;
      this.playerStateEndsAt = now + 16;
    } else if (this.playerState === PlayerState.Block) {
      this.playerState = PlayerState.Idle;
    }

    if (this.playerState === PlayerState.Dodge) {
      if (now >= this.playerStateEndsAt) {
        this.playerState = PlayerState.Idle;
        this.player.clearTint();
      }
      return;
    }

    this.player.clearTint();
    const speedMultiplier = this.playerState === PlayerState.Attack ? 0.4 : this.playerState === PlayerState.Block ? 0.52 : 1;
    const speed = BALANCE.player.baseSpeed * speedMultiplier;
    this.player.setVelocity(move.x * speed, move.y * speed);

    if (this.controls.justPressed('interact')) {
      this.handleInteraction();
    }

    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    if (delta > 0 && playerBody.velocity.lengthSq() < 4) {
      this.player.setVelocity(0, 0);
    }
  }

  private updateCountdown(delta: number): void {
    if (this.houndReleased || this.missionComplete) {
      return;
    }

    const drainMultiplier = this.torchEquipped ? BALANCE.torch.countdownDrainMultiplier : 1;
    this.countdownRemainingMs = Math.max(0, this.countdownRemainingMs - delta * drainMultiplier);

    if (this.countdownWarningStage === 'none' && this.countdownRemainingMs <= BALANCE.countdown.lowWarningMs) {
      this.countdownWarningStage = 'low';
      this.soundCues.play('alertTrigger');
      this.setMessage('Kennel chain rattling. Light buys sight, but time is slipping.');
    }

    if (this.countdownWarningStage !== 'critical' && this.countdownRemainingMs <= BALANCE.countdown.criticalWarningMs) {
      this.countdownWarningStage = 'critical';
      this.soundCues.play('alertTrigger');
      this.cameras.main.flash(160, 255, 110, 110, false);
      this.setMessage('Critical pressure. The hound is almost loose.');
    }

    if (this.countdownRemainingMs <= 0) {
      this.releaseHound();
    }
  }

  private updateGuard(now: number, delta: number): void {
    const sight = this.getGuardSight();
    if (this.guardState !== GuardState.Stunned) {
      if (sight.seesPlayer && sight.distance <= BALANCE.guard.chaseDistance) {
        this.setGuardState(GuardState.Chase, now, BALANCE.guard.chaseMemoryMs);
        this.guardLastSeen.set(this.player.x, this.player.y);
      } else if (sight.seesPlayer) {
        if (this.guardState !== GuardState.Chase) {
          this.setGuardState(GuardState.Suspicious, now, BALANCE.guard.suspiciousDurationMs);
        } else {
          this.guardStateUntil = now + BALANCE.guard.chaseMemoryMs;
        }
        this.guardLastSeen.set(this.player.x, this.player.y);
      } else if (this.guardState === GuardState.Chase && now >= this.guardStateUntil) {
        this.setGuardState(GuardState.Return, now);
      }
    }

    switch (this.guardState) {
      case GuardState.Patrol: {
        const target = this.patrolPoints[this.guardPatrolIndex];
        this.moveActorTowards(this.guard, target, BALANCE.guard.patrolSpeed);
        if (Phaser.Math.Distance.Between(this.guard.x, this.guard.y, target.x, target.y) < 10) {
          this.guardPatrolIndex = (this.guardPatrolIndex + 1) % this.patrolPoints.length;
        }
        break;
      }
      case GuardState.Suspicious: {
        this.moveActorTowards(this.guard, this.guardLastSeen, BALANCE.guard.suspiciousSpeed);
        if (Phaser.Math.Distance.Between(this.guard.x, this.guard.y, this.guardLastSeen.x, this.guardLastSeen.y) < BALANCE.guard.alertDistanceTolerance) {
          this.guard.setVelocity(0, 0);
        }
        if (now >= this.guardStateUntil) {
          this.setGuardState(GuardState.Return, now);
        }
        break;
      }
      case GuardState.Chase: {
        this.guardLastSeen.set(this.player.x, this.player.y);
        this.guardStateUntil = sight.seesPlayer ? now + BALANCE.guard.chaseMemoryMs : this.guardStateUntil;
        this.moveActorTowards(this.guard, this.guardLastSeen, BALANCE.guard.chaseSpeed);
        break;
      }
      case GuardState.Return: {
        const target = this.patrolPoints[this.guardPatrolIndex];
        this.moveActorTowards(this.guard, target, BALANCE.guard.returnSpeed);
        if (Phaser.Math.Distance.Between(this.guard.x, this.guard.y, target.x, target.y) < BALANCE.guard.returnTolerance) {
          this.setGuardState(GuardState.Patrol, now);
        }
        break;
      }
      case GuardState.Stunned: {
        this.guard.setVelocity(0, 0);
        if (now >= this.guardStateUntil) {
          this.setGuardState(GuardState.Return, now);
        }
        break;
      }
      default:
        break;
    }

    const playerTooCloseWithSight =
      sight.distance <= BALANCE.guard.nearDetection * this.getDetectionExposureMultiplier() &&
      sight.seesPlayer &&
      this.guardState !== GuardState.Stunned;
    if (playerTooCloseWithSight) {
      this.setGuardState(GuardState.Chase, now, BALANCE.guard.chaseMemoryMs);
      this.guardLastSeen.set(this.player.x, this.player.y);
    }

    const guardBody = this.guard.body as Phaser.Physics.Arcade.Body;
    this.updateFacingFromVelocity(this.guardFacing, guardBody.velocity);
    if (this.guardState !== GuardState.Stunned && guardBody.velocity.lengthSq() > 20 && now >= this.guardNextFootstepAt) {
      this.guardNextFootstepAt = now + BALANCE.audio.guardFootstepIntervalMs;
      this.soundCues.play('guardFootstep');
    }

    if (delta > 0 && guardBody.velocity.lengthSq() < 4) {
      this.guard.setVelocity(0, 0);
    }
  }

  private updateHound(now: number): void {
    if (!this.houndReleased) {
      return;
    }

    if (this.houndState === HoundState.Reset) {
      if (now < this.houndStateUntil) {
        return;
      }

      this.hound.enableBody(true, this.houndSpawn.x, this.houndSpawn.y, true, true);
      this.houndHealth = BALANCE.hound.maxHealth;
      this.houndLastSeen.copy(this.houndReleaseTarget);
      this.setHoundState(HoundState.Released, now, 1200);
    }

    if (!this.isHoundActive()) {
      return;
    }

    const sight = this.getHoundSight();
    if (sight.seesPlayer) {
      this.houndLastSeen.set(this.player.x, this.player.y);
      if (sight.distance <= BALANCE.hound.attackRange) {
        this.setHoundState(HoundState.Attack, now, BALANCE.hound.attackDurationMs);
      } else {
        this.setHoundState(HoundState.Chase, now, BALANCE.hound.chaseMemoryMs);
      }
    } else if (this.houndState === HoundState.Chase && now >= this.houndStateUntil) {
      this.setHoundState(HoundState.Search, now, BALANCE.hound.searchDurationMs);
    } else if (this.houndState === HoundState.Search && now >= this.houndStateUntil) {
      this.setHoundState(HoundState.Reset, now, BALANCE.hound.recoverMs);
      this.resetHoundToKennel();
      return;
    }

    switch (this.houndState) {
      case HoundState.Released:
        this.moveActorTowards(this.hound, this.houndReleaseTarget, BALANCE.hound.releasedSpeed);
        if (Phaser.Math.Distance.Between(this.hound.x, this.hound.y, this.houndReleaseTarget.x, this.houndReleaseTarget.y) < 12 || now >= this.houndStateUntil) {
          this.setHoundState(HoundState.Search, now, BALANCE.hound.searchDurationMs);
        }
        break;
      case HoundState.Search:
        this.moveActorTowards(this.hound, this.houndLastSeen, BALANCE.hound.searchSpeed);
        break;
      case HoundState.Chase:
        this.houndStateUntil = sight.seesPlayer ? now + BALANCE.hound.chaseMemoryMs : this.houndStateUntil;
        this.moveActorTowards(this.hound, this.houndLastSeen, BALANCE.hound.chaseSpeed);
        break;
      case HoundState.Attack:
        this.moveActorTowards(this.hound, this.player, BALANCE.hound.chaseSpeed + 14);
        if (now >= this.houndStateUntil) {
          this.setHoundState(HoundState.Chase, now, BALANCE.hound.chaseMemoryMs);
        }
        break;
      case HoundState.Idle:
      case HoundState.Reset:
      default:
        break;
    }

    const houndBody = this.hound.body as Phaser.Physics.Arcade.Body;
    this.updateFacingFromVelocity(this.houndFacing, houndBody.velocity);
    if (houndBody.velocity.lengthSq() > 12 && now >= this.houndNextGrowlAt) {
      this.houndNextGrowlAt = now + BALANCE.audio.houndGrowlIntervalMs;
      this.soundCues.play(this.houndState === HoundState.Attack || this.houndState === HoundState.Chase ? 'houndBark' : 'houndGrowl');
    }
  }

  private updateInteractionPrompt(): void {
    this.currentPrompt = '';

    if (this.torchPickup && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.torchPickup.x, this.torchPickup.y) <= BALANCE.torch.interactDistance) {
      this.currentPrompt = 'Press E or F to grab the torch.';
    } else if (this.keyPickup && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.keyPickup.x, this.keyPickup.y) <= 42) {
      this.currentPrompt = 'Press E or F to grab the brass key.';
    } else if (this.hasTorch) {
      this.currentPrompt = this.torchEquipped ? 'Torch lit. Tap Q or T to douse it.' : 'Torch stowed. Tap Q or T to light it.';
    }

    if (!this.currentPrompt && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.lockedDoor.x, this.lockedDoor.y) <= 56) {
      this.currentPrompt = this.doorUnlocked
        ? 'Archive door is open. Slip inside.'
        : this.hasKey
          ? 'Press E or F to unlock the archive door.'
          : 'Locked door. The key is somewhere past the guard.';
    }

    this.promptText.setText(this.currentPrompt);
  }

  private handleInteraction(): void {
    if (this.torchPickup && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.torchPickup.x, this.torchPickup.y) <= BALANCE.torch.interactDistance) {
      this.hasTorch = true;
      this.torchPickup.destroy();
      this.torchPickup = undefined;
      if (this.torchPickupLight) {
        this.lights.removeLight(this.torchPickupLight);
        this.torchPickupLight = undefined;
      }
      this.soundCues.play('torchPickup');
      this.setMessage('Torch secured. More sight, more risk.');
      return;
    }

    if (this.keyPickup && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.keyPickup.x, this.keyPickup.y) <= 42) {
      this.hasKey = true;
      this.keyPickup.destroy();
      this.keyPickup = undefined;
      this.soundCues.play('keyPickup');
      this.setMessage('Key secured. Tiny chaos, maximum usefulness.');
      return;
    }

    if (!this.doorUnlocked && this.hasKey && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.lockedDoor.x, this.lockedDoor.y) <= 56) {
      this.unlockDoor();
      this.soundCues.play('doorUnlock');
      this.setMessage('Door unlocked. The archive chamber is open.');
      return;
    }

    if (!this.doorUnlocked && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.lockedDoor.x, this.lockedDoor.y) <= 56) {
      this.setMessage('No key yet. The guard owns this little loop.');
    }
  }

  private toggleTorch(): void {
    if (!this.hasTorch) {
      this.setMessage('No torch in the kit yet.');
      return;
    }

    this.torchEquipped = !this.torchEquipped;
    this.soundCues.play(this.torchEquipped ? 'torchToggleOn' : 'torchToggleOff');
    this.setMessage(this.torchEquipped ? 'Torch up. Vision widens, the clock snarls.' : 'Torch down. Harder to see, harder to track.');
  }

  private unlockDoor(): void {
    this.doorUnlocked = true;
    this.lockedDoorCollider?.destroy();
    this.lockedDoor.destroy();
  }

  private resolveAttack(): void {
    const attackedHound = this.tryAttackEnemy(this.hound, this.houndFacing, this.isHoundActive(), 'hound');
    if (attackedHound) {
      return;
    }

    const attackedGuard = this.tryAttackEnemy(this.guard, this.guardFacing, true, 'guard');
    if (attackedGuard) {
      return;
    }

    this.setMessage('Slash! Close, but no cigar.');
  }

  private tryAttackEnemy(
    enemy: Phaser.Physics.Arcade.Sprite,
    facing: Phaser.Math.Vector2,
    active: boolean,
    enemyType: 'guard' | 'hound',
  ): boolean {
    if (!active) {
      return false;
    }

    const toEnemy = new Phaser.Math.Vector2(enemy.x - this.player.x, enemy.y - this.player.y);
    const distance = toEnemy.length();
    if (distance > BALANCE.player.attackReach) {
      return false;
    }

    toEnemy.normalize();
    const aimDot = Phaser.Math.Clamp(this.playerFacing.dot(toEnemy), -1, 1);
    const angle = Math.acos(aimDot);
    if (angle > Phaser.Math.DegToRad(BALANCE.player.attackArcDeg)) {
      return false;
    }

    if (enemyType === 'guard') {
      if (this.guardState !== GuardState.Stunned) {
        this.setGuardState(GuardState.Stunned, this.time.now, BALANCE.guard.stunMs);
        this.guard.setVelocity(0, 0);
        this.setMessage('Clean hit. Guard staggered.');
      }
      return true;
    }

    this.houndHealth -= 1;
    if (this.houndHealth <= 0) {
      this.setHoundState(HoundState.Reset, this.time.now, BALANCE.hound.recoverMs);
      this.resetHoundToKennel();
      this.setMessage('Hound dropped. It will recover, but you bought breathing room.');
    } else {
      this.houndLastSeen.set(this.player.x, this.player.y);
      this.setHoundState(HoundState.Search, this.time.now, BALANCE.hound.searchDurationMs);
      enemy.setVelocity((enemy.x - this.player.x) * 1.8, (enemy.y - this.player.y) * 1.8);
      this.setMessage('The hound yelps and circles back. One more hit will floor it.');
    }

    return true;
  }

  private handleGuardContact(): void {
    const now = this.time.now;
    if (this.guardState === GuardState.Stunned || now < this.playerDamageCooldownEndsAt || this.missionComplete) {
      return;
    }

    if (this.playerState === PlayerState.Dodge) {
      return;
    }

    const guardToPlayer = new Phaser.Math.Vector2(this.guard.x - this.player.x, this.guard.y - this.player.y).normalize();
    const facingDot = this.playerFacing.dot(guardToPlayer);
    if (this.playerState === PlayerState.Block && facingDot > 0.1) {
      if (now - this.blockStartedAt <= BALANCE.player.blockArcMs) {
        this.setGuardState(GuardState.Stunned, now, BALANCE.guard.stunMs);
        this.guard.setVelocity(0, 0);
        this.setMessage('Perfect parry! The guard is seeing stars.');
      } else {
        this.setMessage('Guard strike blocked.');
      }
      this.playerDamageCooldownEndsAt = now + 400;
      return;
    }

    this.applyEnemyDamage(guardToPlayer, 1, `Oof. Health at ${Math.max(this.playerHealth - 1, 0)}.`);
  }

  private handleHoundContact(): void {
    const now = this.time.now;
    if (!this.isHoundActive() || this.houndState === HoundState.Reset || now < this.playerDamageCooldownEndsAt || this.missionComplete) {
      return;
    }

    if (this.playerState === PlayerState.Dodge) {
      return;
    }

    const houndToPlayer = new Phaser.Math.Vector2(this.hound.x - this.player.x, this.hound.y - this.player.y).normalize();
    const frontalBlock = this.playerState === PlayerState.Block && this.playerFacing.dot(houndToPlayer) > 0.2;
    if (frontalBlock) {
      this.playerDamageCooldownEndsAt = now + 350;
      this.setMessage('The hound slams the shield line but doesn’t break through.');
      return;
    }

    if (now >= this.houndNextBarkAt) {
      this.houndNextBarkAt = now + BALANCE.audio.barkCooldownMs;
      this.soundCues.play('houndBark');
    }

    this.applyEnemyDamage(houndToPlayer, BALANCE.hound.damage, `Mauled. Health at ${Math.max(this.playerHealth - BALANCE.hound.damage, 0)}.`);
  }

  private applyEnemyDamage(direction: Phaser.Math.Vector2, amount: number, message: string): void {
    this.playerHealth -= amount;
    this.playerDamageCooldownEndsAt = this.time.now + BALANCE.player.damageCooldownMs;
    const knockback = direction.scale(-BALANCE.player.contactKnockback);
    this.player.setVelocity(knockback.x, knockback.y);
    this.cameras.main.shake(130, 0.008);
    this.setMessage(message);

    if (this.playerHealth <= 0) {
      this.respawnPlayer();
    }
  }

  private respawnPlayer(): void {
    this.playerHealth = BALANCE.player.maxHealth;
    this.player.setPosition(this.playerSpawn.x, this.playerSpawn.y);
    this.player.setVelocity(0, 0);
    this.playerState = PlayerState.Idle;
    this.playerFacing.copy(this.lastMoveDirection);

    this.guard.setPosition(this.guardSpawn.x, this.guardSpawn.y);
    this.guard.setVelocity(0, 0);
    this.guardPatrolIndex = 0;
    this.setGuardState(GuardState.Patrol, this.time.now);

    if (this.houndReleased) {
      this.resetHoundToKennel();
      this.setHoundState(HoundState.Released, this.time.now, 1200);
      this.hound.enableBody(true, this.houndSpawn.x, this.houndSpawn.y, true, true);
      this.houndHealth = BALANCE.hound.maxHealth;
      this.houndLastSeen.copy(this.houndReleaseTarget);
    }

    this.setMessage('Dragged back to the wing entrance. Try a sneakier route.');
  }

  private releaseHound(): void {
    if (this.houndReleased) {
      return;
    }

    this.houndReleased = true;
    this.countdownWarningStage = 'released';
    this.hound.enableBody(true, this.houndSpawn.x, this.houndSpawn.y, true, true);
    this.houndHealth = BALANCE.hound.maxHealth;
    this.houndLastSeen.copy(this.player);
    this.setHoundState(HoundState.Released, this.time.now, 1200);
    this.houndWarningLight.setIntensity(BALANCE.hound.warningLightIntensity);
    this.soundCues.play('alertTrigger');
    this.soundCues.play('houndGrowl');
    this.cameras.main.flash(BALANCE.hound.warningFlashMs / 10, 255, 70, 70, false);
    this.cameras.main.shake(180, 0.01);
    this.setMessage('Kennel breach. Hound released. Move or get eaten.');
  }

  private resetHoundToKennel(): void {
    this.hound.disableBody(true, true);
    this.hound.setPosition(this.houndSpawn.x, this.houndSpawn.y);
    this.hound.setVelocity(0, 0);
    this.houndFacing.set(-1, 0);
    this.houndWarningLight.setIntensity(0.28);
  }

  private setGuardState(state: GuardState, now: number, durationMs?: number): void {
    const changed = this.guardState !== state;
    this.guardState = state;
    if (durationMs !== undefined) {
      this.guardStateUntil = now + durationMs;
    }

    if (changed && (state === GuardState.Suspicious || state === GuardState.Chase)) {
      this.soundCues.play('alertTrigger');
    }
  }

  private setHoundState(state: HoundState, now: number, durationMs?: number): void {
    const changed = this.houndState !== state;
    this.houndState = state;
    if (durationMs !== undefined) {
      this.houndStateUntil = now + durationMs;
    }

    if (!changed) {
      return;
    }

    if (state === HoundState.Chase || state === HoundState.Attack) {
      this.soundCues.play('houndBark');
    } else if (state === HoundState.Released || state === HoundState.Search) {
      this.soundCues.play('houndGrowl');
    }
  }

  private getDetectionExposureMultiplier(): number {
    return this.torchEquipped ? BALANCE.torch.exposureMultiplier : 1;
  }

  private isHoundActive(): boolean {
    const body = this.hound.body as Phaser.Physics.Arcade.Body | null;
    return Boolean(body?.enable);
  }

  private getGuardSight(): { seesPlayer: boolean; distance: number } {
    const toPlayer = new Phaser.Math.Vector2(this.player.x - this.guard.x, this.player.y - this.guard.y);
    const distance = toPlayer.length();
    const sightDistance = BALANCE.guard.sightDistance * this.getDetectionExposureMultiplier();
    if (distance > sightDistance) {
      return { seesPlayer: false, distance };
    }

    const direction = toPlayer.clone().normalize();
    const dot = Phaser.Math.Clamp(this.guardFacing.dot(direction), -1, 1);
    const angle = Math.acos(dot);
    const blocked = this.isLineBlocked(this.guard.x, this.guard.y, this.player.x, this.player.y);
    const seesPlayer = angle <= GUARD_VIEW_ANGLE / 2 && !blocked;
    return { seesPlayer, distance };
  }

  private getHoundSight(): { seesPlayer: boolean; distance: number } {
    const toPlayer = new Phaser.Math.Vector2(this.player.x - this.hound.x, this.player.y - this.hound.y);
    const distance = toPlayer.length();
    const sightDistance = BALANCE.hound.sightDistance * this.getDetectionExposureMultiplier();
    if (distance > sightDistance) {
      return { seesPlayer: false, distance };
    }

    const direction = toPlayer.clone().normalize();
    const dot = Phaser.Math.Clamp(this.houndFacing.dot(direction), -1, 1);
    const angle = Math.acos(dot);
    const blocked = this.isLineBlocked(this.hound.x, this.hound.y, this.player.x, this.player.y);
    const seesPlayer = (!blocked && angle <= HOUND_VIEW_ANGLE / 2) || distance <= BALANCE.hound.nearDetection;
    return { seesPlayer, distance };
  }

  private isLineBlocked(x1: number, y1: number, x2: number, y2: number): boolean {
    const line = new Phaser.Geom.Line(x1, y1, x2, y2);
    return this.wallRects.some((rect) => Phaser.Geom.Intersects.LineToRectangle(line, rect));
  }

  private moveActorTowards(
    actor: Phaser.Physics.Arcade.Sprite,
    target: Phaser.Math.Vector2 | Phaser.GameObjects.Components.Transform,
    speed: number,
  ): void {
    const velocity = new Phaser.Math.Vector2(target.x - actor.x, target.y - actor.y);
    if (velocity.lengthSq() <= 1) {
      actor.setVelocity(0, 0);
      return;
    }

    velocity.normalize().scale(speed);
    actor.setVelocity(velocity.x, velocity.y);
  }

  private updateFacingFromVelocity(targetFacing: Phaser.Math.Vector2, velocity: Phaser.Math.Vector2): void {
    if (velocity.lengthSq() > 6) {
      targetFacing.copy(velocity.clone().normalize());
    }
  }

  private drawSightCones(): void {
    const guardColorByState: Record<GuardState, number> = {
      [GuardState.Patrol]: 0xd4b259,
      [GuardState.Suspicious]: 0xf58a3c,
      [GuardState.Chase]: 0xdd4d5f,
      [GuardState.Return]: 0x8c97b5,
      [GuardState.Stunned]: 0x7bd8ff,
    };

    this.guardSightGraphics.clear();
    this.drawSightCone(
      this.guardSightGraphics,
      this.guard.x,
      this.guard.y,
      this.guardFacing,
      BALANCE.guard.sightDistance * this.getDetectionExposureMultiplier(),
      GUARD_VIEW_ANGLE,
      guardColorByState[this.guardState],
      this.guardState === GuardState.Chase ? 0.28 : 0.18,
    );

    this.houndSightGraphics.clear();
    if (this.isHoundActive()) {
      const houndAlpha = this.houndState === HoundState.Chase || this.houndState === HoundState.Attack ? 0.3 : 0.15;
      this.drawSightCone(
        this.houndSightGraphics,
        this.hound.x,
        this.hound.y,
        this.houndFacing,
        BALANCE.hound.sightDistance * this.getDetectionExposureMultiplier(),
        HOUND_VIEW_ANGLE,
        0xff5b67,
        houndAlpha,
      );
    }
  }

  private drawSightCone(
    graphics: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    facing: Phaser.Math.Vector2,
    distance: number,
    angleWidth: number,
    color: number,
    alpha: number,
  ): void {
    graphics.fillStyle(color, alpha);
    graphics.lineStyle(2, color, Math.min(alpha + 0.2, 0.5));

    const start = Math.atan2(facing.y, facing.x) - angleWidth / 2;
    const steps = 18;
    graphics.beginPath();
    graphics.moveTo(x, y);
    for (let i = 0; i <= steps; i += 1) {
      const angle = start + (angleWidth / steps) * i;
      const px = x + Math.cos(angle) * distance;
      const py = y + Math.sin(angle) * distance;
      graphics.lineTo(px, py);
    }
    graphics.closePath();
    graphics.fillPath();
    graphics.strokePath();
  }

  private updateLightsAndUi(now: number): void {
    this.playerLight.x = this.player.x;
    this.playerLight.y = this.player.y;

    let lightRadius: number = BALANCE.player.lightRadius;
    let lightIntensity: number = BALANCE.player.lightIntensity;

    if (this.torchEquipped) {
      lightRadius = BALANCE.player.torchLightRadius;
      lightIntensity = BALANCE.player.torchLightIntensity;
    }

    if (this.playerState === PlayerState.Dodge) {
      lightRadius = Math.max(lightRadius, BALANCE.player.dodgeLightRadius);
    }

    if (this.playerState === PlayerState.Block) {
      lightIntensity = BALANCE.player.blockLightIntensity;
    }

    this.playerLight.radius = lightRadius;
    this.playerLight.intensity = lightIntensity;
    this.playerLight.setColor(this.torchEquipped ? 0xffd28a : 0xe8f4ff);

    const warningPulse = this.houndReleased
      ? 0.75 + Math.sin(now / 120) * 0.25
      : this.countdownRemainingMs <= BALANCE.countdown.criticalWarningMs
        ? 0.25 + Math.sin(now / 180) * 0.12
        : 0.2;
    this.houndWarningLight.setIntensity(this.houndReleased ? warningPulse : Math.max(0.16, warningPulse));

    const guardLabel = (() => {
      switch (this.guardState) {
        case GuardState.Patrol:
          return 'patrolling';
        case GuardState.Suspicious:
          return 'suspicious';
        case GuardState.Chase:
          return 'chasing';
        case GuardState.Return:
          return 'resetting';
        case GuardState.Stunned:
          return 'stunned';
        default:
          return 'unknown';
      }
    })();

    const houndLabel = (() => {
      switch (this.houndState) {
        case HoundState.Idle:
          return 'dormant';
        case HoundState.Released:
          return 'released';
        case HoundState.Search:
          return 'searching';
        case HoundState.Chase:
          return 'chasing';
        case HoundState.Attack:
          return 'lunging';
        case HoundState.Reset:
          return 'resetting';
        default:
          return 'unknown';
      }
    })();

    const cooldown = Math.max(0, this.dodgeCooldownEndsAt - now);
    const dodgeSeconds = cooldown > 0 ? (cooldown / 1000).toFixed(1) : 'ready';
    const timerLabel = this.houndReleased ? 'RELEASED' : this.formatCountdown(this.countdownRemainingMs);

    this.hudText.setText([
      `HP ${'♥'.repeat(this.playerHealth)}${'·'.repeat(BALANCE.player.maxHealth - this.playerHealth)}`,
      `Key ${this.hasKey ? 'yes' : 'no'}`,
      `Torch ${this.hasTorch ? (this.torchEquipped ? 'lit' : 'stowed') : 'none'}`,
      `Kennel ${timerLabel}`,
      `Dodge ${dodgeSeconds}`,
    ].join('  •  '));
    this.statusText.setText(`Guard ${guardLabel}  •  Hound ${houndLabel}  •  Player ${this.playerState}`);

    this.objectiveText.setText(
      this.missionComplete
        ? 'Archive breached — horror loop clear.'
        : 'Objective: torch/key → door → archive, before the hound eats the plan',
    );

    if (now >= this.messageExpiresAt) {
      this.messageText.setText('');
    }
  }

  private checkObjective(): void {
    if (!this.doorUnlocked || this.missionComplete) {
      return;
    }

    const overlapping = Phaser.Geom.Intersects.RectangleToRectangle(this.player.getBounds(), this.objectiveZone.getBounds());
    if (overlapping) {
      this.missionComplete = true;
      this.setMessage('Wing breached. Horror slice objective complete.');
    }
  }

  private formatCountdown(ms: number): string {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  private setMessage(message: string): void {
    this.messageText.setText(message);
    this.messageExpiresAt = this.time.now + BALANCE.ui.messageDurationMs;
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: 'app',
  backgroundColor: BALANCE.world.backgroundColor,
  physics: {
    default: 'arcade',
    arcade: {
      debug: false,
      gravity: { x: 0, y: 0 },
    },
  },
  scene: [DungeonCrawlerScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: {
    activePointers: 2,
    mouse: {
      preventDefaultDown: true,
    },
  },
};

new Phaser.Game(config);
