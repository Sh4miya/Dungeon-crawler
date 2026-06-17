import './style.css';
import * as THREE from 'three';

type PlayerState = 'idle' | 'attack' | 'block' | 'dodge';
type GuardState = 'patrol' | 'suspicious' | 'chase' | 'return' | 'stunned';

type WallRect = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  mesh: THREE.Mesh;
};

type UiRefs = {
  hud: HTMLDivElement;
  status: HTMLDivElement;
  message: HTMLDivElement;
  objective: HTMLDivElement;
  prompt: HTMLDivElement;
  controls: HTMLDivElement;
  crosshair: HTMLDivElement;
};

const WORLD_WIDTH = 36;
const WORLD_DEPTH = 24;
const PLAYER_RADIUS = 0.42;
const GUARD_RADIUS = 0.42;
const PLAYER_HEIGHT = 1.72;
const PLAYER_MOVE_SPEED = 4.2;
const PLAYER_DODGE_SPEED = 9.2;
const PLAYER_DODGE_DURATION = 0.2;
const PLAYER_DODGE_COOLDOWN = 0.95;
const PLAYER_ATTACK_DURATION = 0.22;
const PLAYER_ATTACK_COOLDOWN = 0.32;
const PLAYER_MAX_HEALTH = 5;
const PLAYER_PARRY_WINDOW = 0.18;
const GUARD_PATROL_SPEED = 2.1;
const GUARD_SUSPICIOUS_SPEED = 2.7;
const GUARD_CHASE_SPEED = 3.7;
const GUARD_RETURN_SPEED = 2.4;
const GUARD_SIGHT_DISTANCE = 8.5;
const GUARD_SIGHT_DISTANCE_TORCH = 13.5;
const GUARD_CHASE_DISTANCE = 5.5;
const GUARD_NEAR_DETECTION = 1.8;
const GUARD_FOV = THREE.MathUtils.degToRad(82);
const GUARD_STUN_SECONDS = 3.2;
const CAMERA_DISTANCE = 4.2;
const CAMERA_SHOULDER_OFFSET = 0.8;
const CAMERA_HEIGHT = 2.2;
const CAMERA_MIN_DISTANCE = 1.2;
const TORCH_ON_INTENSITY = 2.8;
const TORCH_OFF_INTENSITY = 0.85;

class DungeonCrawlerApp {
  private readonly container: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ui: UiRefs;
  private readonly pressedKeys = new Set<string>();
  private readonly pointerButtons = { left: false, right: false };
  private readonly previousButtons = { left: false, right: false };
  private readonly walls: WallRect[] = [];
  private readonly wallMeshes: THREE.Object3D[] = [];
  private readonly guardWaypoints = [
    new THREE.Vector3(23.5, 0, 15.5),
    new THREE.Vector3(28.5, 0, 15.5),
    new THREE.Vector3(28.5, 0, 8.5),
    new THREE.Vector3(30.5, 0, 8.5),
    new THREE.Vector3(28.5, 0, 8.5),
    new THREE.Vector3(28.5, 0, 15.5),
  ];
  private readonly player = {
    pos: new THREE.Vector3(4.5, PLAYER_HEIGHT * 0.5, 12),
    velocity: new THREE.Vector3(),
    facing: new THREE.Vector3(0, 0, -1),
    mesh: new THREE.Group(),
    body: new THREE.Mesh(),
    state: 'idle' as PlayerState,
    stateTimer: 0,
    attackCooldown: 0,
    dodgeCooldown: 0,
    damageCooldown: 0,
    blockTimer: 0,
    health: PLAYER_MAX_HEALTH,
    hasKey: false,
    torchOn: false,
    missionComplete: false,
  };
  private readonly guard = {
    pos: new THREE.Vector3(28.5, PLAYER_HEIGHT * 0.5, 12),
    velocity: new THREE.Vector3(),
    facing: new THREE.Vector3(0, 0, -1),
    mesh: new THREE.Group(),
    body: new THREE.Mesh(),
    state: 'patrol' as GuardState,
    stateTimer: 0,
    patrolIndex: 0,
    lastSeen: new THREE.Vector3(28.5, PLAYER_HEIGHT * 0.5, 12),
  };
  private readonly key = {
    pos: new THREE.Vector3(29, 0.55, 8.5),
    mesh: new THREE.Mesh(),
    active: true,
  };
  private readonly door = {
    pos: new THREE.Vector3(18.2, 1.1, 12),
    mesh: new THREE.Group(),
    locked: true,
  };
  private readonly exitZone = {
    minX: 11.4,
    maxX: 15.8,
    minZ: 10,
    maxZ: 14,
  };
  private readonly minimap = {
    mesh: new THREE.Mesh(),
  };
  private readonly torchLight = new THREE.SpotLight(0xf7d089, TORCH_OFF_INTENSITY, 16, Math.PI / 7, 0.55, 1.2);
  private readonly fillLight = new THREE.PointLight(0xa6d7ff, 0.75, 5.5, 2);
  private readonly doorLight = new THREE.PointLight(0xffd27a, 1.1, 5.2, 2);
  private readonly keyLight = new THREE.PointLight(0xffd27a, 1.4, 4.8, 2);
  private readonly ambientLight = new THREE.AmbientLight(0x111726, 0.24);
  private readonly torchTarget = new THREE.Object3D();
  private readonly interactTip = new THREE.Vector3();
  private readonly tmpVecA = new THREE.Vector3();
  private readonly tmpVecB = new THREE.Vector3();
  private readonly tmpVecC = new THREE.Vector3();
  private readonly spawnPoint = new THREE.Vector3(4.5, PLAYER_HEIGHT * 0.5, 12);
  private readonly guardSpawn = new THREE.Vector3(28.5, PLAYER_HEIGHT * 0.5, 12);

  private yaw = Math.PI;
  private pitch = -0.2;
  private message = 'Scout report: find the brass key, then crack open the archive door.';
  private messageTimer = 4;

  constructor(container: HTMLElement) {
    this.container = container;
    this.ui = this.createUi();
    this.setupRenderer();
    this.setupScene();
    this.createLevel();
    this.createActors();
    this.bindEvents();
    this.onResize();
    this.render();
  }

  private setupRenderer(): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x070910);
    this.container.appendChild(this.renderer.domElement);
  }

  private setupScene(): void {
    this.scene.fog = new THREE.Fog(0x070910, 8, 26);
    this.scene.add(this.ambientLight);

    const moon = new THREE.DirectionalLight(0x7f9ac8, 0.42);
    moon.position.set(8, 14, 6);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = 40;
    moon.shadow.camera.left = -16;
    moon.shadow.camera.right = 16;
    moon.shadow.camera.top = 16;
    moon.shadow.camera.bottom = -16;
    this.scene.add(moon);

    this.torchLight.position.set(0, PLAYER_HEIGHT * 0.75, 0);
    this.torchLight.castShadow = true;
    this.torchLight.shadow.mapSize.set(1024, 1024);
    this.torchLight.shadow.camera.near = 0.2;
    this.torchLight.shadow.camera.far = 18;
    this.torchTarget.position.set(0, PLAYER_HEIGHT * 0.68, -2);
    this.scene.add(this.torchTarget);
    this.scene.add(this.torchLight);
    this.scene.add(this.torchLight.target);

    this.fillLight.position.copy(this.player.pos).add(new THREE.Vector3(0, 0.6, 0));
    this.scene.add(this.fillLight);

    this.doorLight.position.copy(this.door.pos).add(new THREE.Vector3(0, 0.2, 0));
    this.scene.add(this.doorLight);

    this.keyLight.position.copy(this.key.pos).add(new THREE.Vector3(0, 0.3, 0));
    this.scene.add(this.keyLight);
  }

  private createUi(): UiRefs {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const topLeft = document.createElement('div');
    topLeft.className = 'panel top-left';
    const hud = document.createElement('div');
    const status = document.createElement('div');
    const message = document.createElement('div');
    message.className = 'message';
    topLeft.append(hud, status, message);

    const topRight = document.createElement('div');
    topRight.className = 'panel top-right';
    const objective = document.createElement('div');
    topRight.append(objective);

    const bottomLeft = document.createElement('div');
    bottomLeft.className = 'panel bottom-left';
    const prompt = document.createElement('div');
    prompt.className = 'prompt';
    const controls = document.createElement('div');
    controls.className = 'controls';
    bottomLeft.append(prompt, controls);

    const centerHint = document.createElement('div');
    centerHint.className = 'center-hint';
    centerHint.textContent = 'Click to capture the mouse · WASD move · Mouse look · LMB attack · RMB block/parry · Space dodge · E interact · Q torch';

    const crosshair = document.createElement('div');
    crosshair.className = 'crosshair';

    overlay.append(topLeft, topRight, bottomLeft, centerHint, crosshair);
    this.container.appendChild(overlay);

    return { hud, status, message, objective, prompt, controls, crosshair };
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.addEventListener('click', () => {
      if (document.pointerLockElement !== this.renderer.domElement) {
        this.renderer.domElement.requestPointerLock();
      }
    });
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private readonly onResize = (): void => {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private readonly onPointerLockChange = (): void => {
    this.ui.crosshair.classList.toggle('active', document.pointerLockElement === this.renderer.domElement);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.pressedKeys.add(event.code);

    if (event.code === 'KeyQ' && !event.repeat) {
      this.player.torchOn = !this.player.torchOn;
      this.setMessage(this.player.torchOn ? 'Torch lit. Better visibility, louder silhouette.' : 'Torch lowered. Harder to see, harder to spot.');
    }
  };
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
    new Phaser.Math.Vector2(700, 300),
    new Phaser.Math.Vector2(700, 192),
    new Phaser.Math.Vector2(750, 192),
    new Phaser.Math.Vector2(700, 192),
    new Phaser.Math.Vector2(700, 300),
    new Phaser.Math.Vector2(700, 520),
    new Phaser.Math.Vector2(80, 520),
    new Phaser.Math.Vector2(80, 120),
    new Phaser.Math.Vector2(860, 120),
    new Phaser.Math.Vector2(860, 520),
    new Phaser.Math.Vector2(700, 520),
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

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.renderer.domElement) {
      return;
    }

    this.yaw -= event.movementX * 0.0027;
    this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.0018, -0.7, 0.35);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button === 0) {
      this.pointerButtons.left = true;
    }
    if (event.button === 2) {
      this.pointerButtons.right = true;
    }
  };

  private readonly onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) {
      this.pointerButtons.left = false;
    }
    if (event.button === 2) {
      this.pointerButtons.right = false;
    }
  };

  private createLevel(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_WIDTH, WORLD_DEPTH),
      new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.92, metalness: 0.02 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.position.set(WORLD_WIDTH * 0.5, 0, WORLD_DEPTH * 0.5);
    this.scene.add(floor);

    const createStrip = (x: number, z: number, width: number, depth: number, color: number): void => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, 0.02, depth),
        new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 }),
      );
      mesh.position.set(x + width * 0.5, 0.01, z + depth * 0.5);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    };

    createStrip(2.5, 2.2, 30.8, 1.2, 0x212b3d);
    createStrip(2.5, 20.6, 30.8, 1.2, 0x212b3d);
    createStrip(10.2, 6.2, 8.4, 11.8, 0x171d29);
    createStrip(22.2, 6.2, 7.8, 3.4, 0x171d29);

    const addWall = (x: number, z: number, width: number, depth: number, height = 2.8): void => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshStandardMaterial({ color: 0x6b7789, roughness: 0.72, metalness: 0.08 }),
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(x + width * 0.5, height * 0.5, z + depth * 0.5);
      this.scene.add(mesh);
      const wallRect: WallRect = { minX: x, maxX: x + width, minZ: z, maxZ: z + depth, height, mesh };
      this.walls.push(wallRect);
      this.wallMeshes.push(mesh);
    };

    addWall(0, 0, WORLD_WIDTH, 1);
    addWall(0, WORLD_DEPTH - 1, WORLD_WIDTH, 1);
    addWall(0, 0, 1, WORLD_DEPTH);
    addWall(WORLD_WIDTH - 1, 0, 1, WORLD_DEPTH);

    addWall(10.2, 6.2, 8.4, 0.7);
    addWall(10.2, 6.2, 0.7, 11.8);
    addWall(10.2, 17.3, 8.4, 0.7);
    addWall(17.9, 6.2, 0.7, 4.2);
    addWall(17.9, 13.6, 0.7, 4.4);

    addWall(22.2, 6.2, 7.8, 0.7);
    addWall(29.3, 6.2, 0.7, 4.1);
    addWall(22.2, 9.6, 3.2, 0.7);
    addWall(26.8, 9.6, 3.2, 0.7);

    addWall(5.2, 6.2, 0.7, 4.2);
    addWall(5.2, 13.7, 0.7, 4.3);
    addWall(5.2, 10.2, 5.7, 0.7);
    addWall(5.2, 13.3, 5.7, 0.7);
    addWall(2.2, 8.1, 3, 0.7);
    addWall(2.2, 15.2, 3, 0.7);

    const doorFrameMaterial = new THREE.MeshStandardMaterial({ color: 0x92847a, roughness: 0.9, metalness: 0.05 });
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 2.8), doorFrameMaterial);
    lintel.position.set(this.door.pos.x, 2.5, this.door.pos.z);
    lintel.castShadow = true;
    this.scene.add(lintel);

    const frameLeft = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 0.45), doorFrameMaterial);
    frameLeft.position.set(this.door.pos.x, 1.2, this.door.pos.z - 1.18);
    frameLeft.castShadow = true;
    this.scene.add(frameLeft);

    const frameRight = frameLeft.clone();
    frameRight.position.z = this.door.pos.z + 1.18;
    this.scene.add(frameRight);

    const exitMarker = new THREE.Mesh(
      new THREE.PlaneGeometry(this.exitZone.maxX - this.exitZone.minX, this.exitZone.maxZ - this.exitZone.minZ),
      new THREE.MeshBasicMaterial({ color: 0x6bd68e, transparent: true, opacity: 0.2 }),
    );
    exitMarker.rotation.x = -Math.PI / 2;
    exitMarker.position.set((this.exitZone.minX + this.exitZone.maxX) * 0.5, 0.03, (this.exitZone.minZ + this.exitZone.maxZ) * 0.5);
    this.scene.add(exitMarker);
  }

  private createActors(): void {
    this.player.mesh = new THREE.Group();
    const playerBody = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 0.9, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x8fd9ff, emissive: 0x123e56, emissiveIntensity: 0.38 }),
    );
    playerBody.castShadow = true;
    playerBody.position.y = 0.88;
    this.player.mesh.add(playerBody);
    this.player.body = playerBody;
    this.player.mesh.position.copy(this.player.pos).setY(0);
    this.scene.add(this.player.mesh);

    this.guard.mesh = new THREE.Group();
    const guardBody = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.34, 0.92, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xce526a, emissive: 0x5d1622, emissiveIntensity: 0.26 }),
    );
    guardBody.castShadow = true;
    guardBody.position.y = 0.9;
    const helmet = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xe8edf6, roughness: 0.7, metalness: 0.5 }),
    );
    helmet.position.y = 1.58;
    helmet.castShadow = true;
    this.guard.mesh.add(guardBody, helmet);
    this.guard.body = guardBody;
    this.guard.mesh.position.copy(this.guard.pos).setY(0);
    this.scene.add(this.guard.mesh);

    this.key.mesh = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.12, 0.04, 48, 8, 2, 3),
      new THREE.MeshStandardMaterial({ color: 0xf2cc6b, emissive: 0xa67115, emissiveIntensity: 0.55, metalness: 0.6, roughness: 0.35 }),
    );
    this.key.mesh.castShadow = true;
    this.key.mesh.position.copy(this.key.pos);
    this.scene.add(this.key.mesh);

    const doorPanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 2.15, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x6f4f30, roughness: 0.82, metalness: 0.04 }),
    );
    doorPanel.castShadow = true;
    const handle = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xcba24b, metalness: 0.8, roughness: 0.25 }),
    );
    handle.position.set(0.2, 0, 0.65);
    doorPanel.add(handle);
    this.door.mesh = new THREE.Group();
    this.door.mesh.add(doorPanel);
    this.door.mesh.position.copy(this.door.pos);
    this.scene.add(this.door.mesh);
  }

  private render = (): void => {
    const delta = Math.min(this.clock.getDelta(), 0.033);
    this.update(delta);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.render);
  };

  private update(delta: number): void {
    this.messageTimer = Math.max(0, this.messageTimer - delta);
    this.updatePlayer(delta);
    this.updateGuard(delta);
    this.updateWorldActors(delta);
    this.updateCamera();
    this.updateUi();
    this.previousButtons.left = this.pointerButtons.left;
    this.previousButtons.right = this.pointerButtons.right;
  }

  private updatePlayer(delta: number): void {
    if (this.player.missionComplete) {
      this.player.velocity.set(0, 0, 0);
      return;
    }

    this.player.attackCooldown = Math.max(0, this.player.attackCooldown - delta);
    this.player.dodgeCooldown = Math.max(0, this.player.dodgeCooldown - delta);
    this.player.damageCooldown = Math.max(0, this.player.damageCooldown - delta);
    this.player.blockTimer = Math.max(0, this.player.blockTimer - delta);
    this.player.stateTimer = Math.max(0, this.player.stateTimer - delta);

    const cameraForward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    const cameraRight = new THREE.Vector3().crossVectors(cameraForward, new THREE.Vector3(0, 1, 0)).normalize();

    const moveInput = new THREE.Vector3();
    if (this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp')) moveInput.add(cameraForward);
    if (this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown')) moveInput.sub(cameraForward);
    if (this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight')) moveInput.add(cameraRight);
    if (this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft')) moveInput.sub(cameraRight);
    moveInput.y = 0;
    if (moveInput.lengthSq() > 0) {
      moveInput.normalize();
      this.player.facing.copy(moveInput);
    } else {
      this.player.facing.copy(cameraForward);
    }

    const justAttack = this.pointerButtons.left && !this.previousButtons.left;
    const justDodge = this.pressedKeys.has('Space') && this.player.dodgeCooldown === 0 && this.player.state !== 'dodge';
    const interactPressed = this.pressedKeys.has('KeyE') || this.pressedKeys.has('KeyF');

    if (justAttack && this.player.attackCooldown === 0 && this.player.state !== 'dodge') {
      this.player.state = 'attack';
      this.player.stateTimer = PLAYER_ATTACK_DURATION;
      this.player.attackCooldown = PLAYER_ATTACK_COOLDOWN;
      this.resolveAttack();
    }

    if (justDodge && this.player.dodgeCooldown === 0) {
      const dodgeDirection = moveInput.lengthSq() > 0 ? moveInput.clone() : this.player.facing.clone();
      this.player.state = 'dodge';
      this.player.stateTimer = PLAYER_DODGE_DURATION;
      this.player.dodgeCooldown = PLAYER_DODGE_COOLDOWN;
      this.player.velocity.copy(dodgeDirection.normalize().multiplyScalar(PLAYER_DODGE_SPEED));
      this.setMessage('Zip! Dodge window active.');
      this.pressedKeys.delete('Space');
    }

    if (this.pointerButtons.right && this.player.state !== 'dodge') {
      if (this.player.state !== 'block') {
        this.player.blockTimer = PLAYER_PARRY_WINDOW;
      }
      this.player.state = 'block';
      this.player.stateTimer = 0.05;
    } else if (this.player.state === 'block') {
      this.player.state = 'idle';
    }

    if (this.player.state === 'dodge') {
      this.moveBody(this.player.pos, this.player.velocity, PLAYER_RADIUS, delta);
      if (this.player.stateTimer === 0) {
        this.player.state = 'idle';
        this.player.velocity.set(0, 0, 0);
      }
    } else {
      const speedMultiplier = this.player.state === 'attack' ? 0.48 : this.player.state === 'block' ? 0.58 : 1;
      const moveVelocity = moveInput.multiplyScalar(PLAYER_MOVE_SPEED * speedMultiplier);
      this.player.velocity.lerp(moveVelocity, 0.34);
      this.moveBody(this.player.pos, this.player.velocity, PLAYER_RADIUS, delta);
      if (this.player.state === 'attack' && this.player.stateTimer === 0) {
        this.player.state = 'idle';
      }
    }

    if (interactPressed) {
      this.handleInteraction();
      this.pressedKeys.delete('KeyE');
      this.pressedKeys.delete('KeyF');
    }

    if (this.player.state !== 'dodge' && this.player.velocity.lengthSq() < 0.0004) {
      this.player.velocity.set(0, 0, 0);
    }

    this.player.mesh.position.set(this.player.pos.x, 0, this.player.pos.z);
    this.player.mesh.rotation.y = Math.atan2(this.player.facing.x, this.player.facing.z);

    this.torchLight.intensity = this.player.torchOn ? TORCH_ON_INTENSITY : TORCH_OFF_INTENSITY;
    this.torchLight.distance = this.player.torchOn ? 21 : 11;
    this.fillLight.intensity = this.player.torchOn ? 0.45 : 0.95;
    this.fillLight.distance = this.player.torchOn ? 3.8 : 5.8;
    this.fillLight.position.copy(this.player.pos).add(new THREE.Vector3(0, 0.55, 0));

    this.torchLight.position.copy(this.player.pos).add(new THREE.Vector3(0, 1.1, 0));
    this.torchTarget.position.copy(this.player.pos).add(this.player.facing.clone().multiplyScalar(3)).add(new THREE.Vector3(0, 0.7, 0));
    this.torchLight.target = this.torchTarget;

    this.keyLight.visible = this.key.active;
    this.keyLight.intensity = this.player.torchOn ? 1.1 : 1.5;

    if (this.player.health <= 0) {
      this.respawnPlayer();
    }
  }

  private updateGuard(delta: number): void {
    if (this.player.missionComplete) {
      this.guard.velocity.set(0, 0, 0);
      return;
    }

    this.guard.stateTimer = Math.max(0, this.guard.stateTimer - delta);
    const sight = this.getGuardSight();

    if (this.guard.state !== 'stunned') {
      if (sight.seesPlayer && sight.distance <= GUARD_CHASE_DISTANCE) {
        this.guard.state = 'chase';
        this.guard.stateTimer = 1.2;
        this.guard.lastSeen.copy(this.player.pos);
      } else if (sight.seesPlayer) {
        if (this.guard.state !== 'chase') {
          this.guard.state = 'suspicious';
        }
        this.guard.stateTimer = 1.8;
        this.guard.lastSeen.copy(this.player.pos);
      } else if (this.guard.state === 'chase' && this.guard.stateTimer === 0) {
        this.guard.state = 'return';
      }
    }

    switch (this.guard.state) {
      case 'patrol': {
        const target = this.guardWaypoints[this.guard.patrolIndex];
        this.moveGuardTowards(target, GUARD_PATROL_SPEED, delta);
        if (this.guard.pos.distanceTo(target) < 0.3) {
          this.guard.patrolIndex = (this.guard.patrolIndex + 1) % this.guardWaypoints.length;
        }
        break;
      }
      case 'suspicious': {
        this.moveGuardTowards(this.guard.lastSeen, GUARD_SUSPICIOUS_SPEED, delta);
        if (this.guard.pos.distanceTo(this.guard.lastSeen) < 0.45) {
          this.guard.velocity.set(0, 0, 0);
        }
        if (this.guard.stateTimer === 0) {
          this.guard.state = 'return';
        }
        break;
      }
      case 'chase': {
        this.guard.lastSeen.copy(this.player.pos);
        this.moveGuardTowards(this.guard.lastSeen, GUARD_CHASE_SPEED, delta);
        break;
      }
      case 'return': {
        const target = this.guardWaypoints[this.guard.patrolIndex];
        this.moveGuardTowards(target, GUARD_RETURN_SPEED, delta);
        if (this.guard.pos.distanceTo(target) < 0.4) {
          this.guard.state = 'patrol';
        }
        break;
      }
      case 'stunned': {
        this.guard.velocity.set(0, 0, 0);
        if (this.guard.stateTimer === 0) {
          this.guard.state = 'return';
        }
        break;
      }
    }

    if (sight.seesPlayer && sight.distance <= GUARD_NEAR_DETECTION && this.guard.state !== 'stunned') {
      this.guard.state = 'chase';
      this.guard.stateTimer = 1.2;
      this.guard.lastSeen.copy(this.player.pos);
    }

    this.handleGuardContact();
    this.guard.mesh.position.set(this.guard.pos.x, 0, this.guard.pos.z);
    this.guard.mesh.rotation.y = Math.atan2(this.guard.facing.x, this.guard.facing.z);

    const guardMaterial = this.guard.body.material as THREE.MeshStandardMaterial;
    const colorByState: Record<GuardState, number> = {
      patrol: 0xce526a,
      suspicious: 0xf0953e,
      chase: 0xf05a6b,
      return: 0x8a93af,
      stunned: 0x7bd8ff,
    };
    guardMaterial.color.setHex(colorByState[this.guard.state]);
  }

  private updateWorldActors(delta: number): void {
    if (this.key.active) {
      this.key.mesh.rotation.y += delta * 1.7;
      this.key.mesh.position.y = this.key.pos.y + Math.sin(performance.now() * 0.003) * 0.04;
    }

    if (!this.player.missionComplete && !this.door.locked && this.isInsideRect(this.player.pos.x, this.player.pos.z, this.exitZone)) {
      this.player.missionComplete = true;
      this.setMessage('Wing breached. Shoulder-slice objective complete.');
    }
  }

  private updateCamera(): void {
    const focus = this.player.pos.clone().add(new THREE.Vector3(0, CAMERA_HEIGHT, 0));
    const shoulder = new THREE.Vector3(
      Math.sin(this.yaw + Math.PI / 2) * CAMERA_SHOULDER_OFFSET,
      0,
      Math.cos(this.yaw + Math.PI / 2) * CAMERA_SHOULDER_OFFSET,
    );
    const baseDirection = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    )
      .normalize()
      .multiplyScalar(-CAMERA_DISTANCE);

    const desiredCamera = focus.clone().add(shoulder).add(baseDirection);
    const cameraAnchor = focus.clone().add(shoulder.multiplyScalar(0.65));
    const direction = desiredCamera.clone().sub(cameraAnchor);
    const distance = direction.length();
    direction.normalize();

    this.raycaster.set(cameraAnchor, direction);
    this.raycaster.far = distance;
    const hits = this.raycaster.intersectObjects(this.wallMeshes, false);
    let finalCamera = desiredCamera;
    if (hits.length > 0) {
      finalCamera = cameraAnchor.clone().add(direction.multiplyScalar(Math.max(CAMERA_MIN_DISTANCE, hits[0].distance - 0.18)));
    }

    this.camera.position.lerp(finalCamera, 0.24);
    this.camera.lookAt(focus);
  }

  private handleInteraction(): void {
    if (this.key.active && this.player.pos.distanceTo(this.key.pos) <= 1.5) {
      this.key.active = false;
      this.player.hasKey = true;
      this.key.mesh.visible = false;
      this.setMessage('Key secured. Tiny chaos, maximum usefulness.');
      return;
    }

    const doorDistance = this.player.pos.distanceTo(this.door.pos);
    if (this.door.locked && this.player.hasKey && doorDistance <= 1.75) {
      this.unlockDoor();
      this.setMessage('Door unlocked. The archive loop is open.');
      return;
    }

    if (this.door.locked && doorDistance <= 1.75) {
      this.setMessage('Locked. The key is somewhere past the guard.');
    }
  }

  private unlockDoor(): void {
    this.door.locked = false;
    this.door.mesh.visible = false;
  }

  private resolveAttack(): void {
    const toGuard = this.guard.pos.clone().sub(this.player.pos);
    const distance = toGuard.length();
    if (distance > 1.8) {
      this.setMessage('Slash! Close, but no cigar.');
      return;
    }

    toGuard.y = 0;
    toGuard.normalize();
    const aimDot = THREE.MathUtils.clamp(this.player.facing.dot(toGuard), -1, 1);
    const angle = Math.acos(aimDot);
    if (angle <= THREE.MathUtils.degToRad(55) && this.guard.state !== 'stunned') {
      this.guard.state = 'stunned';
      this.guard.stateTimer = GUARD_STUN_SECONDS;
      this.guard.velocity.set(0, 0, 0);
      this.setMessage('Clean hit. Guard staggered.');
      return;
    }

    this.setMessage('Your swing whiffs past the helmet.');
  }

  private handleGuardContact(): void {
    const distance = this.guard.pos.distanceTo(this.player.pos);
    if (distance > PLAYER_RADIUS + GUARD_RADIUS + 0.18 || this.guard.state === 'stunned' || this.player.missionComplete) {
      return;
    }

    if (this.player.damageCooldown > 0 || this.player.state === 'dodge') {
      return;
    }

    const guardToPlayer = this.player.pos.clone().sub(this.guard.pos).setY(0).normalize();
    const facingDot = this.player.facing.dot(guardToPlayer);
    if (this.player.state === 'block' && facingDot > 0.12) {
      if (this.player.blockTimer > 0) {
        this.guard.state = 'stunned';
        this.guard.stateTimer = GUARD_STUN_SECONDS;
        this.guard.velocity.set(0, 0, 0);
        this.setMessage('Perfect parry! The guard is seeing stars.');
      } else {
        this.setMessage('Guard strike blocked.');
      }
      this.player.damageCooldown = 0.4;
      return;
    }

    this.player.health -= 1;
    this.player.damageCooldown = 1;
    const knockback = guardToPlayer.multiplyScalar(2.3);
    this.player.pos.add(knockback);
    this.player.pos.y = PLAYER_HEIGHT * 0.5;
    this.setMessage(`Oof. Health at ${Math.max(this.player.health, 0)}.`);
  }

  private respawnPlayer(): void {
    this.player.health = PLAYER_MAX_HEALTH;
    this.player.pos.copy(this.spawnPoint);
    this.player.velocity.set(0, 0, 0);
    this.player.state = 'idle';
    this.player.hasKey = false;
    this.player.torchOn = false;
    this.key.active = true;
    this.key.mesh.visible = true;
    this.door.locked = true;
    this.door.mesh.visible = true;
    this.guard.pos.copy(this.guardSpawn);
    this.guard.velocity.set(0, 0, 0);
    this.guard.state = 'patrol';
    this.guard.stateTimer = 0;
    this.guard.patrolIndex = 0;
    this.setMessage('Dragged back to the wing entrance. Try a sneakier route.');
  }

  private getGuardSight(): { seesPlayer: boolean; distance: number } {
    const toPlayer = this.player.pos.clone().sub(this.guard.pos);
    toPlayer.y = 0;
    const distance = toPlayer.length();
    const detectionDistance = this.player.torchOn ? GUARD_SIGHT_DISTANCE_TORCH : GUARD_SIGHT_DISTANCE;
    if (distance > detectionDistance) {
      return { seesPlayer: false, distance };
    }

    const direction = toPlayer.normalize();
    const dot = THREE.MathUtils.clamp(this.guard.facing.dot(direction), -1, 1);
    const angle = Math.acos(dot);
    const blocked = this.isLineBlocked(this.guard.pos.x, this.guard.pos.z, this.player.pos.x, this.player.pos.z);
    const seesPlayer = angle <= GUARD_FOV / 2 && !blocked;
    return { seesPlayer, distance };
  }

  private isLineBlocked(x1: number, z1: number, x2: number, z2: number): boolean {
    return this.walls.some((wall) => this.lineIntersectsRect(x1, z1, x2, z2, wall));
  }

  private lineIntersectsRect(x1: number, z1: number, x2: number, z2: number, wall: WallRect): boolean {
    if ((x1 >= wall.minX && x1 <= wall.maxX && z1 >= wall.minZ && z1 <= wall.maxZ) || (x2 >= wall.minX && x2 <= wall.maxX && z2 >= wall.minZ && z2 <= wall.maxZ)) {
      return true;
    }

    const edges: Array<[number, number, number, number]> = [
      [wall.minX, wall.minZ, wall.maxX, wall.minZ],
      [wall.maxX, wall.minZ, wall.maxX, wall.maxZ],
      [wall.maxX, wall.maxZ, wall.minX, wall.maxZ],
      [wall.minX, wall.maxZ, wall.minX, wall.minZ],
    ];

    return edges.some(([ax, az, bx, bz]) => this.segmentsIntersect(x1, z1, x2, z2, ax, az, bx, bz));
  }

  private segmentsIntersect(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number): boolean {
    const det = (a: number, b: number, c: number, d: number) => a * d - b * c;
    const denominator = det(x1 - x2, y1 - y2, x3 - x4, y3 - y4);
    if (Math.abs(denominator) < 1e-8) {
      return false;
    }

    const pre = det(x1, y1, x2, y2);
    const post = det(x3, y3, x4, y4);
    const x = det(pre, x1 - x2, post, x3 - x4) / denominator;
    const y = det(pre, y1 - y2, post, y3 - y4) / denominator;

    const within = (value: number, start: number, end: number) => value >= Math.min(start, end) - 1e-6 && value <= Math.max(start, end) + 1e-6;
    return within(x, x1, x2) && within(x, x3, x4) && within(y, y1, y2) && within(y, y3, y4);
  }

  private moveGuardTowards(target: THREE.Vector3, speed: number, delta: number): void {
    const velocity = target.clone().sub(this.guard.pos);
    velocity.y = 0;
    if (velocity.lengthSq() <= 0.0001) {
      this.guard.velocity.set(0, 0, 0);
      return;
    }

    velocity.normalize();
    this.guard.facing.lerp(velocity, 0.22).normalize();
    this.guard.velocity.copy(velocity.multiplyScalar(speed));
    this.moveBody(this.guard.pos, this.guard.velocity, GUARD_RADIUS, delta);
  }

  private moveBody(position: THREE.Vector3, velocity: THREE.Vector3, radius: number, delta: number): void {
    position.x += velocity.x * delta;
    this.resolveCollisions(position, radius, 'x');
    position.z += velocity.z * delta;
    this.resolveCollisions(position, radius, 'z');
    position.y = PLAYER_HEIGHT * 0.5;
  }

  private resolveCollisions(position: THREE.Vector3, radius: number, axis: 'x' | 'z'): void {
    for (const wall of this.walls) {
      const closestX = THREE.MathUtils.clamp(position.x, wall.minX, wall.maxX);
      const closestZ = THREE.MathUtils.clamp(position.z, wall.minZ, wall.maxZ);
      const dx = position.x - closestX;
      const dz = position.z - closestZ;
      const distanceSq = dx * dx + dz * dz;

      if (distanceSq >= radius * radius || distanceSq === 0) {
        continue;
      }

      const distance = Math.sqrt(distanceSq);
      const overlap = radius - distance;
      if (axis === 'x') {
        position.x += (dx / distance) * overlap;
      } else {
        position.z += (dz / distance) * overlap;
      }
    }

    if (!this.door.locked) {
      return;
    }

    const doorRect = { minX: 17.92, maxX: 18.48, minZ: 10.92, maxZ: 13.08 };
    const closestX = THREE.MathUtils.clamp(position.x, doorRect.minX, doorRect.maxX);
    const closestZ = THREE.MathUtils.clamp(position.z, doorRect.minZ, doorRect.maxZ);
    const dx = position.x - closestX;
    const dz = position.z - closestZ;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq >= radius * radius || distanceSq === 0) {
      return;
    }

    const distance = Math.sqrt(distanceSq);
    const overlap = radius - distance;
    if (axis === 'x') {
      position.x += (dx / distance) * overlap;
    } else {
      position.z += (dz / distance) * overlap;
    }
  }

  private isInsideRect(x: number, z: number, rect: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean {
    return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
  }

  private updateUi(): void {
    const guardLabel: Record<GuardState, string> = {
      patrol: 'patrolling',
      suspicious: 'suspicious',
      chase: 'chasing',
      return: 'resetting',
      stunned: 'stunned',
    };

    this.ui.hud.textContent = `HP ${'♥'.repeat(this.player.health)}${'·'.repeat(PLAYER_MAX_HEALTH - this.player.health)}  •  Key ${this.player.hasKey ? 'yes' : 'no'}  •  Dodge ${this.player.dodgeCooldown > 0 ? this.player.dodgeCooldown.toFixed(1) : 'ready'}  •  Torch ${this.player.torchOn ? 'on' : 'off'}`;
    this.ui.status.textContent = `Guard ${guardLabel[this.guard.state]}  •  Player ${this.player.state}`;
    this.ui.message.textContent = this.messageTimer > 0 ? this.message : '';
    this.ui.objective.textContent = this.player.missionComplete ? 'Archive breached — shoulder slice clear.' : 'Objective: key → door → archive';
    this.ui.prompt.textContent = this.getPromptText();
    this.ui.controls.textContent = 'Shoulder camera uses mouse look with obstruction push-in. Torch boosts visibility, but extends guard sight range.';
  }

  private getPromptText(): string {
    if (this.key.active && this.player.pos.distanceTo(this.key.pos) <= 1.5) {
      return 'Press E or F to grab the brass key.';
    }

    const doorDistance = this.player.pos.distanceTo(this.door.pos);
    if (doorDistance <= 1.75) {
      if (this.door.locked && this.player.hasKey) {
        return 'Press E or F to unlock the archive door.';
      }
      if (this.door.locked) {
        return 'Locked door. The key is somewhere past the guard.';
      }
      return 'Archive door is open. Slip inside.';
    }

    return '';
  }

  private setMessage(message: string): void {
    this.message = message;
    this.messageTimer = 3.1;
  }
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('App container not found.');
}

new DungeonCrawlerApp(app);
