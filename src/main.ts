import * as Phaser from 'phaser';
import './style.css';

const GAME_WIDTH = 960;
const GAME_HEIGHT = 640;
const WALL_THICKNESS = 32;
const PLAYER_BASE_SPEED = 150;
const PLAYER_DODGE_SPEED = 290;
const PLAYER_DODGE_DURATION = 180;
const PLAYER_DODGE_COOLDOWN = 900;
const PLAYER_ATTACK_DURATION = 220;
const PLAYER_ATTACK_COOLDOWN = 280;
const PLAYER_BLOCK_ARC_MS = 160;
const PLAYER_MAX_HEALTH = 5;
const GUARD_PATROL_SPEED = 72;
const GUARD_SUSPICIOUS_SPEED = 88;
const GUARD_CHASE_SPEED = 132;
const GUARD_RETURN_SPEED = 82;
const GUARD_STUN_MS = 1500;
const GUARD_SIGHT_DISTANCE = 220;
const GUARD_CHASE_DISTANCE = 120;
const GUARD_NEAR_DETECTION = 70;
const GUARD_VIEW_ANGLE = Phaser.Math.DegToRad(78);

type ActionName =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'attack'
  | 'block'
  | 'dodge'
  | 'interact';

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

  rebind(action: ActionName, bindings: Binding[]): void {
    this.bindings[action] = bindings;
    bindings.forEach((binding) => {
      if (binding.type === 'keyboard' && !this.keys.has(binding.code)) {
        this.keys.set(binding.code, this.scene.input.keyboard!.addKey(binding.code));
      }
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
    ].join(' • ');
  }
}

class DungeonCrawlerScene extends Phaser.Scene {
  private controls!: ControlManager;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private player!: Phaser.Physics.Arcade.Sprite;
  private guard!: Phaser.Physics.Arcade.Sprite;
  private keyPickup?: Phaser.Physics.Arcade.Sprite;
  private lockedDoor!: Phaser.Physics.Arcade.Sprite;
  private lockedDoorCollider?: Phaser.Physics.Arcade.Collider;
  private objectiveZone!: Phaser.GameObjects.Zone;
  private playerLight!: Phaser.GameObjects.Light;
  private guardSightGraphics!: Phaser.GameObjects.Graphics;
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
  private guardState = GuardState.Patrol;
  private guardStateUntil = 0;
  private guardLastSeen = new Phaser.Math.Vector2(0, 0);
  private guardSpawn = new Phaser.Math.Vector2(700, 300);
  private guardPatrolIndex = 0;
  private readonly patrolPoints = [
    new Phaser.Math.Vector2(650, 300),
    new Phaser.Math.Vector2(700, 300),
    new Phaser.Math.Vector2(700, 190),
    new Phaser.Math.Vector2(750, 190),
    new Phaser.Math.Vector2(700, 190),
    new Phaser.Math.Vector2(700, 300),
  ];
  private wallRects: Phaser.Geom.Rectangle[] = [];
  private hasKey = false;
  private doorUnlocked = false;
  private playerHealth = PLAYER_MAX_HEALTH;
  private playerDamageCooldownEndsAt = 0;
  private missionComplete = false;
  private currentPrompt = '';
  private messageExpiresAt = 0;
  private readonly playerSpawn = new Phaser.Math.Vector2(108, 320);

  constructor() {
    super('dungeon-crawler');
  }

  preload(): void {
    this.createTextures();
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#090a11');
    this.input.mouse?.disableContextMenu();
    this.controls = new ControlManager(this, DEFAULT_BINDINGS);

    this.physics.world.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.createLevel();
    this.createActors();
    this.createUi();
    this.createCollisions();
    this.setMessage('Scout report: find the brass key, then crack open the archive door.');
  }

  update(_time: number, delta: number): void {
    const now = this.time.now;
    this.controls.updatePointerState();

    if (!this.missionComplete) {
      this.updatePlayer(now, delta);
      this.updateInteractionPrompt();
      this.updateGuard(now, delta);
      this.checkObjective();
    } else {
      this.player.setVelocity(0, 0);
      this.guard.setVelocity(0, 0);
    }

    this.updateLightsAndUi(now);
    this.drawGuardSightCone();
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

    this.objectiveZone = this.add.zone(416, 320, 120, 120);
    this.physics.add.existing(this.objectiveZone);
    const objectiveBody = this.objectiveZone.body as Phaser.Physics.Arcade.Body;
    objectiveBody.setAllowGravity(false);
    objectiveBody.moves = false;

    this.lights.addLight(700, 192, 90, 0xf2cc6b, 1.2).setIntensity(1.2);
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

    this.lights.enable().setAmbientColor(0x090a12);
    this.playerLight = this.lights.addLight(this.player.x, this.player.y, 180, 0xe8f4ff, 1.8);
    this.playerLight.setIntensity(1.8);
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
    this.controlsText.setText(`Remappable controls ready: ${this.controls.summary()}`);
    this.messageText = makeText(18, 68, '16px', '#f2cc6b');
    this.promptText = makeText(18, 566, '16px', '#8fe3ff');
    this.objectiveText = makeText(942, 16, '18px', '#ffd479').setOrigin(1, 0);

    this.guardSightGraphics = this.add.graphics().setDepth(2);
  }

  private createCollisions(): void {
    this.physics.add.collider(this.player, this.walls);
    this.physics.add.collider(this.guard, this.walls);
    this.lockedDoorCollider = this.physics.add.collider(this.player, this.lockedDoor);
    this.physics.add.collider(this.guard, this.lockedDoor);
    this.physics.add.overlap(this.player, this.guard, () => this.handleGuardContact());
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
      this.playerStateEndsAt = now + PLAYER_ATTACK_DURATION;
      this.attackCooldownEndsAt = now + PLAYER_ATTACK_COOLDOWN;
      this.resolveAttack();
    }

    if (this.controls.justPressed('dodge') && now >= this.dodgeCooldownEndsAt) {
      this.playerState = PlayerState.Dodge;
      this.playerStateEndsAt = now + PLAYER_DODGE_DURATION;
      this.dodgeCooldownEndsAt = now + PLAYER_DODGE_COOLDOWN;
      const dodgeDirection = move.lengthSq() > 0 ? move.clone() : this.playerFacing.clone();
      dodgeDirection.normalize();
      this.player.setVelocity(dodgeDirection.x * PLAYER_DODGE_SPEED, dodgeDirection.y * PLAYER_DODGE_SPEED);
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
    const speed = PLAYER_BASE_SPEED * speedMultiplier;
    this.player.setVelocity(move.x * speed, move.y * speed);

    if (this.controls.justPressed('interact')) {
      this.handleInteraction();
    }

    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    if (delta > 0 && playerBody.velocity.lengthSq() < 4) {
      this.player.setVelocity(0, 0);
    }
  }

  private updateGuard(now: number, delta: number): void {
    const sight = this.getGuardSight();
    if (this.guardState !== GuardState.Stunned) {
      if (sight.seesPlayer && sight.distance <= GUARD_CHASE_DISTANCE) {
        this.guardState = GuardState.Chase;
        this.guardStateUntil = now + 1200;
        this.guardLastSeen.set(this.player.x, this.player.y);
      } else if (sight.seesPlayer) {
        if (this.guardState !== GuardState.Chase) {
          this.guardState = GuardState.Suspicious;
        }
        this.guardStateUntil = now + 1800;
        this.guardLastSeen.set(this.player.x, this.player.y);
      } else if (this.guardState === GuardState.Chase && now >= this.guardStateUntil) {
        this.guardState = GuardState.Return;
      }
    }

    switch (this.guardState) {
      case GuardState.Patrol: {
        const target = this.patrolPoints[this.guardPatrolIndex];
        this.moveGuardTowards(target, GUARD_PATROL_SPEED);
        if (Phaser.Math.Distance.Between(this.guard.x, this.guard.y, target.x, target.y) < 10) {
          this.guardPatrolIndex = (this.guardPatrolIndex + 1) % this.patrolPoints.length;
        }
        break;
      }
      case GuardState.Suspicious: {
        this.moveGuardTowards(this.guardLastSeen, GUARD_SUSPICIOUS_SPEED);
        if (Phaser.Math.Distance.Between(this.guard.x, this.guard.y, this.guardLastSeen.x, this.guardLastSeen.y) < 14) {
          this.guard.setVelocity(0, 0);
        }
        if (now >= this.guardStateUntil) {
          this.guardState = GuardState.Return;
        }
        break;
      }
      case GuardState.Chase: {
        this.guardLastSeen.set(this.player.x, this.player.y);
        this.guardStateUntil = sight.seesPlayer ? now + 1200 : this.guardStateUntil;
        this.moveGuardTowards(this.guardLastSeen, GUARD_CHASE_SPEED);
        break;
      }
      case GuardState.Return: {
        const target = this.patrolPoints[this.guardPatrolIndex];
        this.moveGuardTowards(target, GUARD_RETURN_SPEED);
        if (Phaser.Math.Distance.Between(this.guard.x, this.guard.y, target.x, target.y) < 12) {
          this.guardState = GuardState.Patrol;
        }
        break;
      }
      case GuardState.Stunned: {
        this.guard.setVelocity(0, 0);
        if (now >= this.guardStateUntil) {
          this.guardState = GuardState.Return;
        }
        break;
      }
      default:
        break;
    }

    const playerTooCloseWithSight =
      sight.distance <= GUARD_NEAR_DETECTION && sight.seesPlayer && this.guardState !== GuardState.Stunned;
    if (playerTooCloseWithSight) {
      this.guardState = GuardState.Chase;
      this.guardStateUntil = now + 1200;
      this.guardLastSeen.set(this.player.x, this.player.y);
    }

    const guardBody = this.guard.body as Phaser.Physics.Arcade.Body;
    const velocity = guardBody.velocity.clone();
    if (velocity.lengthSq() > 6) {
      velocity.normalize();
      this.guardFacing.copy(velocity);
    }

    if (delta > 0 && guardBody.velocity.lengthSq() < 4) {
      this.guard.setVelocity(0, 0);
    }
  }

  private updateInteractionPrompt(): void {
    this.currentPrompt = '';
    if (this.keyPickup && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.keyPickup.x, this.keyPickup.y) <= 42) {
      this.currentPrompt = 'Press E or F to grab the brass key.';
    } else if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.lockedDoor.x, this.lockedDoor.y) <= 56) {
      this.currentPrompt = this.doorUnlocked
        ? 'Archive door is open. Slip inside.'
        : this.hasKey
          ? 'Press E or F to unlock the archive door.'
          : 'Locked door. The key is somewhere past the guard.';
    }
    this.promptText.setText(this.currentPrompt);
  }

  private handleInteraction(): void {
    if (this.keyPickup && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.keyPickup.x, this.keyPickup.y) <= 42) {
      this.hasKey = true;
      this.keyPickup.destroy();
      this.keyPickup = undefined;
      this.setMessage('Key secured. Tiny chaos, maximum usefulness.');
      return;
    }

    if (!this.doorUnlocked && this.hasKey && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.lockedDoor.x, this.lockedDoor.y) <= 56) {
      this.unlockDoor();
      this.setMessage('Door unlocked. The archive chamber is open.');
      return;
    }

    if (!this.doorUnlocked && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.lockedDoor.x, this.lockedDoor.y) <= 56) {
      this.setMessage('No key yet. The guard owns this little loop.');
    }
  }

  private unlockDoor(): void {
    this.doorUnlocked = true;
    this.lockedDoorCollider?.destroy();
    this.lockedDoor.destroy();
  }

  private resolveAttack(): void {
    const toGuard = new Phaser.Math.Vector2(this.guard.x - this.player.x, this.guard.y - this.player.y);
    const distance = toGuard.length();
    if (distance > 78) {
      this.setMessage('Slash! Close, but no cigar.');
      return;
    }

    toGuard.normalize();
    const aimDot = Phaser.Math.Clamp(this.playerFacing.dot(toGuard), -1, 1);
    const angle = Math.acos(aimDot);
    if (angle <= Phaser.Math.DegToRad(55) && this.guardState !== GuardState.Stunned) {
      this.guardState = GuardState.Stunned;
      this.guardStateUntil = this.time.now + GUARD_STUN_MS;
      this.guard.setVelocity(0, 0);
      this.setMessage('Clean hit. Guard staggered.');
      return;
    }

    this.setMessage('Your swing whiffs past the helmet.');
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
      if (now - this.blockStartedAt <= PLAYER_BLOCK_ARC_MS) {
        this.guardState = GuardState.Stunned;
        this.guardStateUntil = now + GUARD_STUN_MS;
        this.guard.setVelocity(0, 0);
        this.setMessage('Perfect parry! The guard is seeing stars.');
      } else {
        this.setMessage('Guard strike blocked.');
      }
      this.playerDamageCooldownEndsAt = now + 400;
      return;
    }

    this.playerHealth -= 1;
    this.playerDamageCooldownEndsAt = now + 1000;
    const knockback = guardToPlayer.scale(-220);
    this.player.setVelocity(knockback.x, knockback.y);
    this.cameras.main.shake(120, 0.007);
    this.setMessage(`Oof. Health at ${Math.max(this.playerHealth, 0)}.`);

    if (this.playerHealth <= 0) {
      this.respawnPlayer();
    }
  }

  private respawnPlayer(): void {
    this.playerHealth = PLAYER_MAX_HEALTH;
    this.player.setPosition(this.playerSpawn.x, this.playerSpawn.y);
    this.player.setVelocity(0, 0);
    this.guard.setPosition(this.guardSpawn.x, this.guardSpawn.y);
    this.guard.setVelocity(0, 0);
    this.guardPatrolIndex = 0;
    this.guardState = GuardState.Patrol;
    this.playerState = PlayerState.Idle;
    this.setMessage('Dragged back to the wing entrance. Try a sneakier route.');
  }

  private getGuardSight(): { seesPlayer: boolean; distance: number } {
    const toPlayer = new Phaser.Math.Vector2(this.player.x - this.guard.x, this.player.y - this.guard.y);
    const distance = toPlayer.length();
    if (distance > GUARD_SIGHT_DISTANCE) {
      return { seesPlayer: false, distance };
    }

    const direction = toPlayer.clone().normalize();
    const dot = Phaser.Math.Clamp(this.guardFacing.dot(direction), -1, 1);
    const angle = Math.acos(dot);
    const blocked = this.isLineBlocked(this.guard.x, this.guard.y, this.player.x, this.player.y);
    const seesPlayer = angle <= GUARD_VIEW_ANGLE / 2 && !blocked;
    return { seesPlayer, distance };
  }

  private isLineBlocked(x1: number, y1: number, x2: number, y2: number): boolean {
    const line = new Phaser.Geom.Line(x1, y1, x2, y2);
    return this.wallRects.some((rect) => Phaser.Geom.Intersects.LineToRectangle(line, rect));
  }

  private moveGuardTowards(target: Phaser.Math.Vector2, speed: number): void {
    const velocity = new Phaser.Math.Vector2(target.x - this.guard.x, target.y - this.guard.y);
    if (velocity.lengthSq() <= 1) {
      this.guard.setVelocity(0, 0);
      return;
    }

    velocity.normalize().scale(speed);
    this.guard.setVelocity(velocity.x, velocity.y);
  }

  private drawGuardSightCone(): void {
    const colorByState: Record<GuardState, number> = {
      [GuardState.Patrol]: 0xd4b259,
      [GuardState.Suspicious]: 0xf58a3c,
      [GuardState.Chase]: 0xdd4d5f,
      [GuardState.Return]: 0x8c97b5,
      [GuardState.Stunned]: 0x7bd8ff,
    };

    this.guardSightGraphics.clear();
    const color = colorByState[this.guardState];
    this.guardSightGraphics.fillStyle(color, this.guardState === GuardState.Chase ? 0.28 : 0.18);
    this.guardSightGraphics.lineStyle(2, color, 0.48);

    const start = Math.atan2(this.guardFacing.y, this.guardFacing.x) - GUARD_VIEW_ANGLE / 2;
    const steps = 18;
    this.guardSightGraphics.beginPath();
    this.guardSightGraphics.moveTo(this.guard.x, this.guard.y);
    for (let i = 0; i <= steps; i += 1) {
      const angle = start + (GUARD_VIEW_ANGLE / steps) * i;
      const px = this.guard.x + Math.cos(angle) * GUARD_SIGHT_DISTANCE;
      const py = this.guard.y + Math.sin(angle) * GUARD_SIGHT_DISTANCE;
      this.guardSightGraphics.lineTo(px, py);
    }
    this.guardSightGraphics.closePath();
    this.guardSightGraphics.fillPath();
    this.guardSightGraphics.strokePath();
  }

  private updateLightsAndUi(now: number): void {
    this.playerLight.x = this.player.x;
    this.playerLight.y = this.player.y;
    this.playerLight.radius = this.playerState === PlayerState.Dodge ? 210 : 180;
    this.playerLight.intensity = this.playerState === PlayerState.Block ? 1.4 : 1.8;

    const alertLabel = (() => {
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

    const cooldown = Math.max(0, this.dodgeCooldownEndsAt - now);
    const dodgeSeconds = cooldown > 0 ? (cooldown / 1000).toFixed(1) : 'ready';
    this.hudText.setText([
      `HP ${'♥'.repeat(this.playerHealth)}${'·'.repeat(PLAYER_MAX_HEALTH - this.playerHealth)}`,
      `Key ${this.hasKey ? 'yes' : 'no'}`,
      `Dodge ${dodgeSeconds}`,
    ].join('  •  '));
    this.statusText.setText(`Guard ${alertLabel}  •  Player ${this.playerState}`);

    this.objectiveText.setText(this.missionComplete ? 'Archive breached — prototype clear.' : 'Objective: key → door → archive');

    if (now >= this.messageExpiresAt) {
      this.messageText.setText('');
    }
  }

  private checkObjective(): void {
    if (!this.doorUnlocked || this.missionComplete) {
      return;
    }

    const overlapping = Phaser.Geom.Intersects.RectangleToRectangle(
      this.player.getBounds(),
      this.objectiveZone.getBounds(),
    );
    if (overlapping) {
      this.missionComplete = true;
      this.setMessage('Wing breached. Vertical slice objective complete.');
    }
  }

  private setMessage(message: string): void {
    this.messageText.setText(message);
    this.messageExpiresAt = this.time.now + 2400;
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: 'app',
  backgroundColor: '#090a11',
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
