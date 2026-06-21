import './style.css';
import * as THREE from 'three';
import { BALANCE } from './gameBalance';
import { findGuardPath, hasClearPath, type Rect as NavigationRect } from './guardNavigation';
import { moveCircle, type Rect as CollisionRect } from './physics';
import { SoundCueManager } from './soundCueManager';

type PlayerState = 'idle' | 'attack' | 'block' | 'dodge';
type GuardState = 'patrol' | 'suspicious' | 'chase' | 'return' | 'stunned';
type GuardAttackPhase = 'idle' | 'windup' | 'strike' | 'recover';
type HoundState = 'idle' | 'released' | 'search' | 'chase' | 'attack' | 'reset' | 'down';
type GamePhase = 'title' | 'playing' | 'death' | 'victory';
type RoomId = 'cell-block' | 'maintenance-tunnel' | 'informant-nook' | 'warden-approach' | 'barracks-key-room' | 'kennel-edge' | 'exit-gate';
type PrisonerRole = 'helper' | 'coward' | 'informant' | 'hostile' | 'silent';
type ObjectiveHintId = 'locked-exit' | 'weapon' | 'key' | 'frame' | 'kennel';
type BindingAction = 'moveUp' | 'moveDown' | 'moveLeft' | 'moveRight' | 'interact' | 'torch' | 'dodge' | 'minimap';

type RoomDefinition = {
  id: RoomId;
  name: string;
  minimapLabel: string;
  discoverMessage: string;
  color: number;
  rect: { minX: number; maxX: number; minZ: number; maxZ: number };
};

type PrisonerState = {
  id: string;
  role: PrisonerRole;
  label: string;
  roomId: RoomId;
  pos: THREE.Vector3;
  mesh: THREE.Group;
  interacted: boolean;
  active: boolean;
};

type NotePickup = {
  id: string;
  title: string;
  roomId: RoomId;
  pos: THREE.Vector3;
  text: string;
  mesh: THREE.Mesh;
  active: boolean;
};

type MinimapDoor = {
  x: number;
  z: number;
  axis: 'vertical' | 'horizontal';
  rooms: [RoomId, RoomId];
};

type WallRect = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  mesh: THREE.Mesh;
};

type UiRefs = {
  overlay: HTMLDivElement;
  hud: HTMLDivElement;
  status: HTMLDivElement;
  timer: HTMLDivElement;
  message: HTMLDivElement;
  objective: HTMLDivElement;
  awareness: HTMLDivElement;
  combat: HTMLDivElement;
  prompt: HTMLDivElement;
  controls: HTMLDivElement;
  crosshair: HTMLDivElement;
  centerHint: HTMLDivElement;
  minimapFrame: HTMLDivElement;
  minimapCanvas: HTMLCanvasElement;
  screen: HTMLDivElement;
  screenEyebrow: HTMLDivElement;
  screenTitle: HTMLHeadingElement;
  screenBody: HTMLParagraphElement;
  screenButtons: HTMLDivElement;
  startButton: HTMLButtonElement;
  controlsButton: HTMLButtonElement;
  backButton: HTMLButtonElement;
  restartButton: HTMLButtonElement;
  titleButton: HTMLButtonElement;
  controlsPanel: HTMLDivElement;
};

const WORLD_WIDTH = BALANCE.world.width;
const WORLD_DEPTH = BALANCE.world.depth;
const PLAYER_RADIUS = BALANCE.player.radius;
const GUARD_RADIUS = BALANCE.guard.radius;
const HOUND_RADIUS = BALANCE.guard.radius;
const PLAYER_HEIGHT = BALANCE.player.height;
const PLAYER_MOVE_SPEED = BALANCE.player.moveSpeed;
const PLAYER_DODGE_SPEED = BALANCE.player.dodgeSpeed;
const PLAYER_DODGE_DURATION = BALANCE.player.dodgeDurationSeconds;
const PLAYER_DODGE_COOLDOWN = BALANCE.player.dodgeCooldownSeconds;
const PLAYER_ATTACK_DURATION = BALANCE.player.attackDurationSeconds;
const PLAYER_ATTACK_COOLDOWN = BALANCE.player.attackCooldownSeconds;
const PLAYER_MAX_HEALTH = BALANCE.player.maxHealth;
const PLAYER_PARRY_WINDOW = BALANCE.player.parryWindowSeconds;
const GUARD_PATROL_SPEED = BALANCE.guard.patrolSpeed;
const GUARD_SUSPICIOUS_SPEED = BALANCE.guard.suspiciousSpeed;
const GUARD_CHASE_SPEED = BALANCE.guard.chaseSpeed;
const GUARD_RETURN_SPEED = BALANCE.guard.returnSpeed;
const GUARD_SIGHT_DISTANCE = BALANCE.guard.sightDistance;
const GUARD_SIGHT_DISTANCE_TORCH = BALANCE.guard.sightDistanceTorch;
const GUARD_CHASE_DISTANCE = BALANCE.guard.chaseDistance;
const GUARD_NEAR_DETECTION = BALANCE.guard.nearDetection;
const GUARD_FOV = THREE.MathUtils.degToRad(BALANCE.guard.fovDeg);
const GUARD_STUN_SECONDS = BALANCE.guard.stunSeconds;
const CAMERA_DISTANCE = BALANCE.camera.distance;
const CAMERA_SHOULDER_OFFSET = BALANCE.camera.shoulderOffset;
const CAMERA_HEIGHT = BALANCE.camera.height;
const CAMERA_MIN_DISTANCE = BALANCE.camera.minDistance;
const TORCH_ON_INTENSITY = BALANCE.torch.onIntensity;
const TORCH_OFF_INTENSITY = BALANCE.torch.offIntensity;
const GUARD_NAV_STEP = BALANCE.guard.navStep;
const MESSAGE_DURATION = BALANCE.ui.messageDurationSeconds;

class DungeonCrawlerApp {
  private readonly container: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly sound = new SoundCueManager();
  private readonly ui: UiRefs;
  private readonly guardFlashColor = new THREE.Color();
  private readonly pressedKeys = new Set<string>();
  private readonly pointerButtons = { left: false, right: false };
  private readonly previousButtons = { left: false, right: false };
  private readonly walls: WallRect[] = [];
  private readonly wallMeshes: THREE.Object3D[] = [];
  private readonly guardWaypoints = [
    ...BALANCE.guard.patrolPoints.map((point) => new THREE.Vector3(point.x, 0, point.z)),
  ];
  private readonly player = {
    pos: new THREE.Vector3(BALANCE.player.spawn.x, PLAYER_HEIGHT * 0.5, BALANCE.player.spawn.z),
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
    health: PLAYER_MAX_HEALTH as number,
    hasKey: false,
    hasTorch: false,
    hasWeapon: false,
    torchOn: false,
    missionComplete: false,
  };
  private readonly guard = {
    pos: new THREE.Vector3(BALANCE.guard.spawn.x, PLAYER_HEIGHT * 0.5, BALANCE.guard.spawn.z),
    velocity: new THREE.Vector3(),
    facing: new THREE.Vector3(0, 0, -1),
    mesh: new THREE.Group(),
    body: new THREE.Mesh(),
    state: 'patrol' as GuardState,
    stateTimer: 0,
    patrolIndex: 0,
    lastSeen: new THREE.Vector3(28.2, PLAYER_HEIGHT * 0.5, 16.1),
    lastPatrolPos: new THREE.Vector3(28.2, PLAYER_HEIGHT * 0.5, 16.1),
    stalledFor: 0,
    footstepTimer: 0,
    attackPhase: 'idle' as GuardAttackPhase,
    attackTimer: 0,
    attackCooldown: 0,
    awarenessLevel: 0,
    awarenessPulseTimer: 0,
  };
  private readonly torchPickup = {
    pos: new THREE.Vector3(BALANCE.torch.pickup.x, BALANCE.torch.pickup.y, BALANCE.torch.pickup.z),
    mesh: new THREE.Group(),
    active: true,
  };
  private readonly hound = {
    pos: new THREE.Vector3(BALANCE.hound.spawn.x, PLAYER_HEIGHT * 0.5, BALANCE.hound.spawn.z),
    velocity: new THREE.Vector3(),
    facing: new THREE.Vector3(0, 0, 1),
    mesh: new THREE.Group(),
    body: new THREE.Mesh(),
    state: 'idle' as HoundState,
    stateTimer: 0,
    attackCooldown: 0,
    damageCooldown: 0,
    health: BALANCE.hound.maxHealth as number,
    lastSeen: new THREE.Vector3(BALANCE.hound.spawn.x, PLAYER_HEIGHT * 0.5, BALANCE.hound.spawn.z),
    warningTimer: 0,
    growlTimer: 0,
    barkTimer: 0,
    releaseTarget: new THREE.Vector3(BALANCE.hound.releaseInvestigateTarget.x, PLAYER_HEIGHT * 0.5, BALANCE.hound.releaseInvestigateTarget.z),
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
  private readonly minimapDoors: MinimapDoor[] = [
    { x: 10.2, z: 12, axis: 'vertical', rooms: ['cell-block', 'informant-nook'] },
    { x: 18.2, z: 12, axis: 'vertical', rooms: ['warden-approach', 'exit-gate'] },
    { x: 22.2, z: 10, axis: 'horizontal', rooms: ['barracks-key-room', 'kennel-edge'] },
    { x: 18.2, z: 16, axis: 'vertical', rooms: ['maintenance-tunnel', 'kennel-edge'] },
  ];
  private readonly rooms: RoomDefinition[] = [
    {
      id: 'cell-block',
      name: 'Cell Block',
      minimapLabel: 'CB',
      discoverMessage: 'Cell block mapped. Shackles, bars, and one suspiciously helpful prisoner.',
      color: 0x4e6785,
      rect: { minX: 1.2, maxX: 10.1, minZ: 8.2, maxZ: 17.8 },
    },
    {
      id: 'maintenance-tunnel',
      name: 'Maintenance Tunnel',
      minimapLabel: 'MT',
      discoverMessage: 'Maintenance tunnel found. Narrow route, easy to read, easy to get cornered.',
      color: 0x697e63,
      rect: { minX: 10.2, maxX: 21.8, minZ: 14.2, maxZ: 19.9 },
    },
    {
      id: 'informant-nook',
      name: 'Informant Nook',
      minimapLabel: 'IN',
      discoverMessage: 'Informant nook discovered. Somebody has been whispering through the bars.',
      color: 0x7b5f84,
      rect: { minX: 10.4, maxX: 17.8, minZ: 6.8, maxZ: 17.1 },
    },
    {
      id: 'warden-approach',
      name: 'Warden Wing Approach',
      minimapLabel: 'WW',
      discoverMessage: 'Warden approach marked. The locked gate is close enough to taste.',
      color: 0x8b684d,
      rect: { minX: 17.9, maxX: 22.1, minZ: 9.8, maxZ: 17.3 },
    },
    {
      id: 'barracks-key-room',
      name: 'Barracks Key Room',
      minimapLabel: 'BK',
      discoverMessage: 'Barracks reached. That is where the guards stash anything pointy and useful.',
      color: 0x7f7b57,
      rect: { minX: 22.3, maxX: 29.2, minZ: 6.6, maxZ: 9.9 },
    },
    {
      id: 'kennel-edge',
      name: 'Kennel Edge',
      minimapLabel: 'KE',
      discoverMessage: 'Kennel edge scoped. More noise, more risk, more reason to move fast.',
      color: 0x804d4d,
      rect: { minX: 22.2, maxX: 29.2, minZ: 9.9, maxZ: 17.6 },
    },
    {
      id: 'exit-gate',
      name: 'Exit Gate Placeholder',
      minimapLabel: 'EG',
      discoverMessage: 'Exit gate chamber sighted. One locked threshold between you and daylight.',
      color: 0x537d73,
      rect: { minX: 11.3, maxX: 16.1, minZ: 9.8, maxZ: 14.3 },
    },
  ];
  private readonly weapon = {
    pos: new THREE.Vector3(24.6, 0.5, 8),
    mesh: new THREE.Group(),
    active: true,
  };
  private readonly notePickups: NotePickup[] = [
    {
      id: 'ledger-scrap',
      title: 'Ledger Scrap',
      roomId: 'cell-block',
      pos: new THREE.Vector3(6.6, 0.42, 15.1),
      text: 'Transfer order 7B: use the thief cover story. The seal was forged after intake. Watch the guard lantern dip before the heavy swing.',
      mesh: new THREE.Mesh(),
      active: true,
    },
    {
      id: 'barracks-order',
      title: 'Barracks Order',
      roomId: 'barracks-key-room',
      pos: new THREE.Vector3(27.6, 0.42, 7.3),
      text: 'Confiscated shiv moved with the brass key. Keep the framed prisoner isolated until the magistrate arrives. His swing is slow after the lantern dips.',
      mesh: new THREE.Mesh(),
      active: true,
    },
  ];
  private readonly prisoners: PrisonerState[] = [
    { id: 'helper', role: 'helper', label: 'Helper', roomId: 'cell-block', pos: new THREE.Vector3(3.8, 0, 12.3), mesh: new THREE.Group(), interacted: false, active: true },
    { id: 'coward', role: 'coward', label: 'Coward', roomId: 'maintenance-tunnel', pos: new THREE.Vector3(15.3, 0, 16.4), mesh: new THREE.Group(), interacted: false, active: true },
    { id: 'informant', role: 'informant', label: 'Informant', roomId: 'informant-nook', pos: new THREE.Vector3(13.4, 0, 8.5), mesh: new THREE.Group(), interacted: false, active: true },
    { id: 'hostile', role: 'hostile', label: 'Hostile', roomId: 'kennel-edge', pos: new THREE.Vector3(24.7, 0, 14.2), mesh: new THREE.Group(), interacted: false, active: true },
    { id: 'silent', role: 'silent', label: 'Silent', roomId: 'warden-approach', pos: new THREE.Vector3(20.1, 0, 15.2), mesh: new THREE.Group(), interacted: false, active: true },
  ];
  private readonly discoveredRooms = new Set<RoomId>(['cell-block']);
  private readonly objectiveHints = new Set<ObjectiveHintId>(['locked-exit']);
  private currentRoomId: RoomId = 'cell-block';
  private readonly torchLight = new THREE.SpotLight(0xf7d089, TORCH_OFF_INTENSITY, 16, Math.PI / 7, 0.55, 1.2);
  private readonly fillLight = new THREE.PointLight(0xa6d7ff, 0.75, 5.5, 2);
  private readonly doorLight = new THREE.PointLight(0xffd27a, 1.1, 5.2, 2);
  private readonly keyLight = new THREE.PointLight(0xffd27a, 1.4, 4.8, 2);
  private readonly warningLight = new THREE.PointLight(0xff664d, 0, BALANCE.hound.warningLightRadius, 2);
  private readonly ambientLight = new THREE.AmbientLight(0x111726, 0.24);
  private readonly guardSightMaterial = new THREE.MeshBasicMaterial({
    color: 0xeac76a,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private readonly guardSightMesh = new THREE.Mesh();
  private readonly houndSightMaterial = new THREE.MeshBasicMaterial({
    color: 0xff6b6b,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  private readonly houndSightMesh = new THREE.Mesh();
  private readonly torchTarget = new THREE.Object3D();
  private readonly interactTip = new THREE.Vector3();
  private readonly tmpVecA = new THREE.Vector3();
  private readonly tmpVecB = new THREE.Vector3();
  private readonly tmpVecC = new THREE.Vector3();
  private readonly spawnPoint = new THREE.Vector3(BALANCE.player.spawn.x, PLAYER_HEIGHT * 0.5, BALANCE.player.spawn.z);
  private readonly guardSpawn = new THREE.Vector3(BALANCE.guard.spawn.x, PLAYER_HEIGHT * 0.5, BALANCE.guard.spawn.z);
  private readonly houndSpawn = new THREE.Vector3(BALANCE.hound.spawn.x, PLAYER_HEIGHT * 0.5, BALANCE.hound.spawn.z);
  private readonly guardPathTarget = new THREE.Vector3();
  private readonly doorCollisionRect = { minX: 17.92, maxX: 18.48, minZ: 10.92, maxZ: 13.08 };

  private guardPath: Array<{ x: number; z: number }> = [];
  private guardRepathTimer = 0;
  private readonly bindingLabels: Record<BindingAction, string> = {
    moveUp: 'Move forward',
    moveDown: 'Move backward',
    moveLeft: 'Strafe left',
    moveRight: 'Strafe right',
    interact: 'Interact',
    torch: 'Toggle torch',
    dodge: 'Dodge',
    minimap: 'Hold minimap',
  };
  private readonly bindings: Record<BindingAction, string> = {
    moveUp: 'KeyW',
    moveDown: 'KeyS',
    moveLeft: 'KeyA',
    moveRight: 'KeyD',
    interact: 'KeyE',
    torch: 'KeyQ',
    dodge: 'Space',
    minimap: 'Tab',
  };
  private readonly bindingButtons = {} as Record<BindingAction, HTMLButtonElement>;
  private phase: GamePhase = 'title';
  private showingControls = false;
  private controlsReturnPhase: GamePhase = 'title';
  private pendingRebind: BindingAction | null = null;
  private readonly wardenEncounter = {
    active: false,
    cleared: false,
    lightsOutTimer: 0,
    torchJamTimer: 0,
  };

  private yaw = Math.PI;
  private pitch = -0.2;
  private message = 'Scout report: the block, tunnel, barracks, kennel edge, and gate are all part of one tight prison loop. Find a weapon, secure the brass key, then crack the gate.';
  private messageTimer: number = MESSAGE_DURATION;
  private countdownRemaining: number = BALANCE.countdown.startSeconds;
  private houndReleased = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.ui = this.createUi();
    this.syncBindingButtons();
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

    this.warningLight.position.copy(this.hound.pos).add(new THREE.Vector3(0, 0.35, 0));
    this.scene.add(this.warningLight);
  }

  private createUi(): UiRefs {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const topLeft = document.createElement('div');
    topLeft.className = 'panel top-left';
    const hud = document.createElement('div');
    hud.className = 'hud';
    const status = document.createElement('div');
    status.className = 'status';
    const timer = document.createElement('div');
    timer.className = 'timer';
    const message = document.createElement('div');
    message.className = 'message';
    topLeft.append(hud, status, timer, message);

    const topRight = document.createElement('div');
    topRight.className = 'panel top-right';
    const objective = document.createElement('div');
    objective.className = 'objective';
    const awareness = document.createElement('div');
    awareness.className = 'awareness';
    const combat = document.createElement('div');
    combat.className = 'combat-read';
    topRight.append(objective, awareness, combat);

    const bottomLeft = document.createElement('div');
    bottomLeft.className = 'panel bottom-left';
    const prompt = document.createElement('div');
    prompt.className = 'prompt';
    const controls = document.createElement('div');
    controls.className = 'controls';
    bottomLeft.append(prompt, controls);

    const centerHint = document.createElement('div');
    centerHint.className = 'center-hint';

    const crosshair = document.createElement('div');
    crosshair.className = 'crosshair';

    const minimapFrame = document.createElement('div');
    minimapFrame.className = 'minimap-frame';
    const minimapTitle = document.createElement('div');
    minimapTitle.className = 'minimap-title';
    minimapTitle.textContent = 'Discovered wing map';
    const minimapCanvas = document.createElement('canvas');
    minimapCanvas.className = 'minimap-canvas';
    minimapCanvas.width = 220;
    minimapCanvas.height = 180;
    minimapFrame.append(minimapTitle, minimapCanvas);

    const screen = document.createElement('div');
    screen.className = 'screen-overlay';
    const screenCard = document.createElement('div');
    screenCard.className = 'screen-card';
    const screenEyebrow = document.createElement('div');
    screenEyebrow.className = 'screen-eyebrow';
    const screenTitle = document.createElement('h1');
    screenTitle.className = 'screen-title';
    const screenBody = document.createElement('p');
    screenBody.className = 'screen-body';
    const screenButtons = document.createElement('div');
    screenButtons.className = 'screen-buttons';
    const startButton = document.createElement('button');
    startButton.className = 'screen-button';
    startButton.type = 'button';
    startButton.textContent = 'Start slice';
    startButton.addEventListener('click', () => this.startRun());
    const controlsButton = document.createElement('button');
    controlsButton.className = 'screen-button secondary';
    controlsButton.type = 'button';
    controlsButton.textContent = 'Controls & remap';
    controlsButton.addEventListener('click', () => this.openControls());
    const backButton = document.createElement('button');
    backButton.className = 'screen-button secondary';
    backButton.type = 'button';
    backButton.textContent = 'Back';
    backButton.addEventListener('click', () => this.closeControls());
    const restartButton = document.createElement('button');
    restartButton.className = 'screen-button';
    restartButton.type = 'button';
    restartButton.textContent = 'Restart run';
    restartButton.addEventListener('click', () => this.restartRun());
    const titleButton = document.createElement('button');
    titleButton.className = 'screen-button secondary';
    titleButton.type = 'button';
    titleButton.textContent = 'Return to title';
    titleButton.addEventListener('click', () => this.returnToTitle());
    const controlsPanel = document.createElement('div');
    controlsPanel.className = 'binding-grid';

    const bindingOrder: BindingAction[] = ['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'interact', 'torch', 'dodge', 'minimap'];
    for (const action of bindingOrder) {
      const row = document.createElement('div');
      row.className = 'binding-row';
      const label = document.createElement('span');
      label.className = 'binding-label';
      label.textContent = this.bindingLabels[action];
      const button = document.createElement('button');
      button.className = 'binding-button';
      button.type = 'button';
      button.addEventListener('click', () => this.beginRebind(action));
      row.append(label, button);
      controlsPanel.append(row);
      this.bindingButtons[action] = button;
    }

    screenButtons.append(startButton, controlsButton, backButton, restartButton, titleButton);
    screenCard.append(screenEyebrow, screenTitle, screenBody, screenButtons, controlsPanel);
    screen.append(screenCard);

    overlay.append(topLeft, topRight, bottomLeft, centerHint, crosshair, minimapFrame, screen);
    this.container.appendChild(overlay);

    return {
      overlay,
      hud,
      status,
      timer,
      message,
      objective,
      awareness,
      combat,
      prompt,
      controls,
      crosshair,
      centerHint,
      minimapFrame,
      minimapCanvas,
      screen,
      screenEyebrow,
      screenTitle,
      screenBody,
      screenButtons,
      startButton,
      controlsButton,
      backButton,
      restartButton,
      titleButton,
      controlsPanel,
    };
  }

  private startRun(resetState = true): void {
    if (resetState) {
      this.respawnPlayer();
      this.setMessage('Slip the wing, arm yourself, then bait the Warden into a bad swing.');
    }
    this.phase = 'playing';
    this.showingControls = false;
    this.pendingRebind = null;
    this.clearPressedInput();
    this.clock.getDelta();
  }

  private restartRun(): void {
    this.startRun(true);
  }

  private returnToTitle(): void {
    this.respawnPlayer();
    this.phase = 'title';
    this.showingControls = false;
    this.pendingRebind = null;
    this.clearPressedInput();
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
    this.setMessage('Scout report: the prison slice now opens with a menu, ends with the Warden, and lets you remap the keys before diving back in.');
  }

  private openControls(): void {
    this.controlsReturnPhase = this.phase;
    this.showingControls = true;
    this.pendingRebind = null;
    this.syncBindingButtons();
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
  }

  private closeControls(): void {
    this.showingControls = false;
    this.pendingRebind = null;
    this.syncBindingButtons();
  }

  private beginRebind(action: BindingAction): void {
    this.pendingRebind = action;
    this.syncBindingButtons();
  }

  private syncBindingButtons(): void {
    const actions = Object.keys(this.bindingLabels) as BindingAction[];
    for (const action of actions) {
      const button = this.bindingButtons[action];
      if (!button) continue;
      const waiting = this.pendingRebind === action;
      button.textContent = waiting ? 'Press a key…' : this.formatBinding(this.bindings[action]);
      button.classList.toggle('listening', waiting);
    }
  }

  private formatBinding(code: string): string {
    if (code === 'Space') return 'Space';
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    return code.replace('Arrow', 'Arrow ');
  }

  private isActionPressed(action: BindingAction): boolean {
    return this.pressedKeys.has(this.bindings[action]);
  }

  private clearPressedInput(): void {
    this.pressedKeys.clear();
    this.pointerButtons.left = false;
    this.pointerButtons.right = false;
    this.previousButtons.left = false;
    this.previousButtons.right = false;
  }

  private getControlsSummary(): string {
    return `${this.formatBinding(this.bindings.moveUp)}/${this.formatBinding(this.bindings.moveLeft)}/${this.formatBinding(this.bindings.moveDown)}/${this.formatBinding(this.bindings.moveRight)} move · Mouse look · LMB strike · RMB block/parry · ${this.formatBinding(this.bindings.dodge)} dodge · ${this.formatBinding(this.bindings.interact)} interact · ${this.formatBinding(this.bindings.torch)} torch · hold ${this.formatBinding(this.bindings.minimap)} map`;
  }

  private getControlsSupportText(): string {
    return `Remap keyboard actions here. Mouse attack/block stay fixed so the Warden duel still reads cleanly.`;
  }

  private enterDeathState(reason: string): void {
    this.phase = 'death';
    this.showingControls = false;
    this.pendingRebind = null;
    this.clearPressedInput();
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
    this.setMessage(reason);
  }

  private enterVictoryState(reason: string): void {
    this.phase = 'victory';
    this.showingControls = false;
    this.pendingRebind = null;
    this.clearPressedInput();
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
    this.setMessage(reason);
  }

  private startWardenEncounter(): void {
    if (this.wardenEncounter.active || this.wardenEncounter.cleared) {
      return;
    }

    this.wardenEncounter.active = true;
    this.wardenEncounter.lightsOutTimer = 5.5;
    this.wardenEncounter.torchJamTimer = 2.8;
    this.guard.state = 'chase';
    this.guard.stateTimer = Math.max(this.guard.stateTimer, BALANCE.guard.chaseMemorySeconds + 1.5);
    this.guard.lastSeen.copy(this.player.pos);
    this.guard.attackPhase = 'idle';
    this.guard.attackTimer = 0;
    this.guard.attackCooldown = 0;
    this.sound.play('alertTrigger');
    this.setMessage('The Warden slams the corridor dark and charges the breach. Parry or stagger him before you bolt.');
  }

  private clearWardenEncounter(): void {
    if (this.wardenEncounter.cleared) {
      return;
    }

    this.wardenEncounter.active = false;
    this.wardenEncounter.cleared = true;
    this.wardenEncounter.lightsOutTimer = 0;
    this.wardenEncounter.torchJamTimer = 0;
    this.ambientLight.intensity = 0.24;
    this.doorLight.intensity = 1.1;
    this.warningLight.intensity = Math.max(this.warningLight.intensity, 0.4);
    this.setMessage('The Warden stumbles. Gate lane is open — move!');
  }

  private isWardenArenaHot(): boolean {
    return this.currentRoomId === 'warden-approach' || this.currentRoomId === 'exit-gate' || this.player.pos.distanceTo(this.door.pos) < 4.5;
  }

  private updateWardenEncounter(delta: number): void {
    if (!this.wardenEncounter.active) {
      this.ambientLight.intensity = this.wardenEncounter.cleared ? 0.24 : 0.24;
      this.doorLight.intensity = this.door.locked ? 1.1 : this.wardenEncounter.cleared ? 1.25 : 1.1;
      return;
    }

    this.wardenEncounter.lightsOutTimer = Math.max(0, this.wardenEncounter.lightsOutTimer - delta);
    this.wardenEncounter.torchJamTimer = Math.max(0, this.wardenEncounter.torchJamTimer - delta);

    if (this.wardenEncounter.lightsOutTimer > 0) {
      this.ambientLight.intensity = 0.08;
      this.doorLight.intensity = 0.3;
    } else {
      this.ambientLight.intensity = 0.18;
      this.doorLight.intensity = 0.8;
    }

    if (this.guard.state === 'stunned' && this.isWardenArenaHot()) {
      this.clearWardenEncounter();
      return;
    }

    if (!this.player.hasTorch) {
      return;
    }

    if (this.isWardenArenaHot() && this.wardenEncounter.torchJamTimer === 0 && !this.wardenEncounter.cleared) {
      this.wardenEncounter.torchJamTimer = 3.6;
      this.player.torchOn = false;
      this.setMessage('The Warden batters the torchlight aside. Find your footing and answer the swing.');
    }
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.addEventListener('click', () => {
      if (this.phase !== 'playing' || this.showingControls) {
        return;
      }
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
    this.ui.crosshair.classList.toggle('active', document.pointerLockElement === this.renderer.domElement && this.phase === 'playing' && !this.showingControls);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === this.bindings.minimap || event.code === 'Tab') {
      event.preventDefault();
    }

    if (this.pendingRebind && !event.repeat) {
      event.preventDefault();
      this.bindings[this.pendingRebind] = event.code;
      this.pendingRebind = null;
      this.syncBindingButtons();
      return;
    }

    if (event.code === 'Escape' && this.showingControls) {
      event.preventDefault();
      this.closeControls();
      return;
    }

    if (event.code === 'KeyC' && !event.repeat) {
      event.preventDefault();
      if (this.showingControls) {
        this.closeControls();
      } else {
        this.openControls();
      }
      return;
    }

    if (this.phase !== 'playing') {
      if (!event.repeat && event.code === 'Enter' && !this.showingControls && this.phase === 'title') {
        this.startRun();
      }
      if (!event.repeat && event.code === 'KeyR' && !this.showingControls && (this.phase === 'death' || this.phase === 'victory')) {
        this.restartRun();
      }
      return;
    }

    this.pressedKeys.add(event.code);

    if (event.code === this.bindings.torch && !event.repeat) {
      if (!this.player.hasTorch) {
        this.setMessage('No torch yet. Find something to light the hall with.');
        return;
      }
      if (this.wardenEncounter.torchJamTimer > 0) {
        this.player.torchOn = false;
        this.setMessage('The Warden snuffed the flame. You will need a moment before it relights.');
        return;
      }

      this.player.torchOn = !this.player.torchOn;
      this.sound.play(this.player.torchOn ? 'torchToggleOn' : 'torchToggleOff');
      this.setMessage(this.player.torchOn ? 'Torch lit. Better visibility, worse stealth, faster kennel countdown.' : 'Torch lowered. Harder to see, harder to spot.');
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === this.bindings.minimap || event.code === 'Tab') {
      event.preventDefault();
    }
    this.pressedKeys.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (this.phase !== 'playing' || this.showingControls || document.pointerLockElement !== this.renderer.domElement) {
      return;
    }

    this.yaw -= event.movementX * 0.0027;
    this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.0018, -0.7, 0.35);
  };

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (this.phase !== 'playing' || this.showingControls) {
      return;
    }
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

  private createSightConeGeometry(radius: number, fov: number, segments = 40): THREE.ShapeGeometry {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);

    for (let index = 0; index <= segments; index += 1) {
      const angle = -fov * 0.5 + (fov * index) / segments;
      shape.lineTo(Math.sin(angle) * radius, Math.cos(angle) * radius);
    }

    shape.lineTo(0, 0);
    return new THREE.ShapeGeometry(shape);
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

    this.guardSightMesh.geometry = this.createSightConeGeometry(1, GUARD_FOV);
    this.guardSightMesh.material = this.guardSightMaterial;
    this.guardSightMesh.rotation.x = -Math.PI / 2;
    this.guardSightMesh.position.set(this.guard.pos.x, 0.04, this.guard.pos.z);
    this.guardSightMesh.renderOrder = 1;
    this.scene.add(this.guardSightMesh);

    this.houndSightMesh.geometry = this.createSightConeGeometry(1, THREE.MathUtils.degToRad(BALANCE.hound.fovDeg));
    this.houndSightMesh.material = this.houndSightMaterial;
    this.houndSightMesh.rotation.x = -Math.PI / 2;
    this.houndSightMesh.position.set(this.hound.pos.x, 0.04, this.hound.pos.z);
    this.houndSightMesh.renderOrder = 1;
    this.scene.add(this.houndSightMesh);

    this.key.mesh = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.12, 0.04, 48, 8, 2, 3),
      new THREE.MeshStandardMaterial({ color: 0xf2cc6b, emissive: 0xa67115, emissiveIntensity: 0.55, metalness: 0.6, roughness: 0.35 }),
    );
    this.key.mesh.castShadow = true;
    this.key.mesh.position.copy(this.key.pos);
    this.scene.add(this.key.mesh);

    const torchHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.09, 0.68, 10),
      new THREE.MeshStandardMaterial({ color: 0x6f4a2b, roughness: 0.88, metalness: 0.05 }),
    );
    torchHandle.rotation.z = Math.PI / 2.8;
    const torchFlame = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 14, 14),
      new THREE.MeshStandardMaterial({ color: 0xffd57c, emissive: 0xcc7a24, emissiveIntensity: 0.7 }),
    );
    torchFlame.position.set(0.26, 0.18, 0);
    this.torchPickup.mesh = new THREE.Group();
    this.torchPickup.mesh.add(torchHandle, torchFlame);
    this.torchPickup.mesh.position.copy(this.torchPickup.pos);
    this.torchPickup.mesh.rotation.y = 0.7;
    this.scene.add(this.torchPickup.mesh);

    this.hound.mesh = new THREE.Group();
    const houndBody = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.7, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x8b5b55, emissive: 0x491c1a, emissiveIntensity: 0.32 }),
    );
    houndBody.rotation.z = Math.PI / 2;
    houndBody.position.y = 0.44;
    houndBody.castShadow = true;
    const houndHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.28, 0.3),
      new THREE.MeshStandardMaterial({ color: 0xa87a72, roughness: 0.8, metalness: 0.04 }),
    );
    houndHead.position.set(0, 0.5, 0.44);
    houndHead.castShadow = true;
    this.hound.mesh.add(houndBody, houndHead);
    this.hound.body = houndBody;
    this.hound.mesh.position.copy(this.hound.pos).setY(0);
    this.hound.mesh.visible = false;
    this.scene.add(this.hound.mesh);

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

    const weaponHandle = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.12, 0.72),
      new THREE.MeshStandardMaterial({ color: 0x7c5436, roughness: 0.88, metalness: 0.05 }),
    );
    const weaponBlade = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.03, 0.72),
      new THREE.MeshStandardMaterial({ color: 0xc7d2da, roughness: 0.4, metalness: 0.72 }),
    );
    weaponBlade.position.set(0.05, 0.08, 0);
    this.weapon.mesh = new THREE.Group();
    this.weapon.mesh.add(weaponHandle, weaponBlade);
    this.weapon.mesh.position.copy(this.weapon.pos);
    this.weapon.mesh.rotation.x = 0.45;
    this.weapon.mesh.rotation.z = 0.22;
    this.scene.add(this.weapon.mesh);

    for (const note of this.notePickups) {
      note.mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.02, 0.26),
        new THREE.MeshStandardMaterial({ color: 0xe6ddba, emissive: 0x66552a, emissiveIntensity: 0.2, roughness: 0.95, metalness: 0.02 }),
      );
      note.mesh.castShadow = true;
      note.mesh.position.copy(note.pos);
      this.scene.add(note.mesh);
    }

    for (const prisoner of this.prisoners) {
      const palette: Record<PrisonerRole, number> = {
        helper: 0x8fd1a3,
        coward: 0xc4c77f,
        informant: 0x9db5ff,
        hostile: 0xd16767,
        silent: 0x9d8fbc,
      };
      prisoner.mesh = this.createPrisonerMesh(palette[prisoner.role]);
      prisoner.mesh.position.set(prisoner.pos.x, 0, prisoner.pos.z);
      this.scene.add(prisoner.mesh);
    }
  }

  private createPrisonerMesh(color: number): THREE.Group {
    const prisoner = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 0.72, 4, 8),
      new THREE.MeshStandardMaterial({ color, emissive: 0x1a1a1a, emissiveIntensity: 0.12 }),
    );
    body.castShadow = true;
    body.position.y = 0.72;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 14, 14),
      new THREE.MeshStandardMaterial({ color: 0xf2dbc1, roughness: 0.9, metalness: 0.02 }),
    );
    head.position.y = 1.38;
    head.castShadow = true;
    prisoner.add(body, head);
    return prisoner;
  }

  private render = (): void => {
    const delta = Math.min(this.clock.getDelta(), 0.033);
    this.update(delta);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.render);
  };

  private update(delta: number): void {
    this.messageTimer = Math.max(0, this.messageTimer - delta);

    if (this.phase === 'playing' && !this.showingControls) {
      this.updateCountdown(delta);
      this.updatePlayer(delta);
      this.updateGuard(delta);
      this.updateHound(delta);
      this.updateWardenEncounter(delta);
      this.updateWorldActors(delta);
      this.updateRoomDiscovery();
    } else {
      this.player.velocity.set(0, 0, 0);
      this.guard.velocity.set(0, 0, 0);
      this.hound.velocity.set(0, 0, 0);
      this.warningLight.intensity = 0;
    }

    this.updateCamera();
    this.updateUi();
    this.previousButtons.left = this.pointerButtons.left;
    this.previousButtons.right = this.pointerButtons.right;
  }

  private updateCountdown(delta: number): void {
    if (this.player.missionComplete || this.houndReleased) {
      return;
    }

    const drainMultiplier = this.player.hasTorch && this.player.torchOn ? BALANCE.torch.countdownDrainMultiplier : 1;
    const previousWholeSeconds = Math.ceil(this.countdownRemaining);
    this.countdownRemaining = Math.max(0, this.countdownRemaining - delta * drainMultiplier);
    const currentWholeSeconds = Math.ceil(this.countdownRemaining);

    if (currentWholeSeconds !== previousWholeSeconds) {
      if (currentWholeSeconds === BALANCE.countdown.lowWarningSeconds) {
        this.sound.play('alertTrigger');
        this.setMessage('Kennel timer low. The halls are starting to wake up.');
      } else if (currentWholeSeconds === BALANCE.countdown.criticalWarningSeconds) {
        this.sound.play('alertTrigger');
        this.setMessage('Critical timer. Expect the hound any second.');
      }
    }

    if (this.countdownRemaining === 0) {
      this.releaseHound();
    }
  }

  private updatePlayer(delta: number): void {
    if (this.player.missionComplete) {
      this.player.velocity.set(0, 0, 0);
      return;
    }

    this.player.attackCooldown = Math.max(0, this.player.attackCooldown - delta);
    this.player.dodgeCooldown = Math.max(0, this.player.dodgeCooldown - delta);
    const dodgeWasCooling = this.player.dodgeCooldown > 0;
    this.player.damageCooldown = Math.max(0, this.player.damageCooldown - delta);
    this.player.blockTimer = Math.max(0, this.player.blockTimer - delta);
    this.player.stateTimer = Math.max(0, this.player.stateTimer - delta);

    const cameraForward = this.camera.getWorldDirection(new THREE.Vector3());
    cameraForward.y = 0;
    if (cameraForward.lengthSq() < 0.0001) {
      cameraForward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    }
    cameraForward.normalize();
    const cameraRight = new THREE.Vector3().crossVectors(cameraForward, new THREE.Vector3(0, 1, 0)).normalize();

    const moveInput = new THREE.Vector3();
    if (this.isActionPressed('moveUp') || this.pressedKeys.has('ArrowUp')) moveInput.add(cameraForward);
    if (this.isActionPressed('moveDown') || this.pressedKeys.has('ArrowDown')) moveInput.sub(cameraForward);
    if (this.isActionPressed('moveRight') || this.pressedKeys.has('ArrowRight')) moveInput.add(cameraRight);
    if (this.isActionPressed('moveLeft') || this.pressedKeys.has('ArrowLeft')) moveInput.sub(cameraRight);
    moveInput.y = 0;
    if (moveInput.lengthSq() > 0) {
      moveInput.normalize();
      this.player.facing.copy(moveInput);
    } else {
      this.player.facing.copy(cameraForward);
    }

    const justAttack = this.pointerButtons.left && !this.previousButtons.left;
    const justDodge = this.isActionPressed('dodge') && this.player.dodgeCooldown === 0 && this.player.state !== 'dodge';
    const interactPressed = this.isActionPressed('interact') || this.pressedKeys.has('KeyF');

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
      this.sound.play('dodgeBurst');
      this.setMessage('Zip! Dodge window active.');
      this.pressedKeys.delete(this.bindings.dodge);
    }

    if (this.pointerButtons.right && this.player.state !== 'dodge') {
      if (this.player.state !== 'block') {
        this.player.blockTimer = PLAYER_PARRY_WINDOW;
        this.sound.play('parryWindow');
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
      this.pressedKeys.delete(this.bindings.interact);
      this.pressedKeys.delete('KeyF');
    }

    if (this.player.state !== 'dodge' && this.player.velocity.lengthSq() < 0.0004) {
      this.player.velocity.set(0, 0, 0);
    }

    this.player.mesh.position.set(this.player.pos.x, 0, this.player.pos.z);
    this.player.mesh.rotation.y = Math.atan2(this.player.facing.x, this.player.facing.z);

    const torchActive = this.player.hasTorch && this.player.torchOn;
    this.torchLight.intensity = torchActive ? TORCH_ON_INTENSITY : TORCH_OFF_INTENSITY;
    this.torchLight.distance = torchActive ? BALANCE.torch.onDistance : BALANCE.torch.offDistance;
    this.fillLight.intensity = torchActive ? BALANCE.torch.fillIntensityOn : BALANCE.torch.fillIntensityOff;
    this.fillLight.distance = torchActive ? BALANCE.torch.fillDistanceOn : BALANCE.torch.fillDistanceOff;
    this.fillLight.position.copy(this.player.pos).add(new THREE.Vector3(0, 0.55, 0));

    this.torchLight.position.copy(this.player.pos).add(new THREE.Vector3(0, 1.1, 0));
    this.torchTarget.position.copy(this.player.pos).add(this.player.facing.clone().multiplyScalar(3)).add(new THREE.Vector3(0, 0.7, 0));
    this.torchLight.target = this.torchTarget;

    this.keyLight.visible = this.key.active;
    this.keyLight.intensity = torchActive ? BALANCE.torch.keyLightIntensityOn : BALANCE.torch.keyLightIntensityOff;
    this.torchPickup.mesh.visible = this.torchPickup.active;

    if (dodgeWasCooling && this.player.dodgeCooldown === 0) {
      this.sound.play('dodgeReady');
    }

    if (this.player.health <= 0) {
      this.enterDeathState('The prison swallowed the run. Regroup, remap if you need to, and try the slice again.');
    }
  }

  private updateGuard(delta: number): void {
    if (this.player.missionComplete) {
      this.guard.velocity.set(0, 0, 0);
      this.clearGuardPath();
      return;
    }

    const previousState = this.guard.state;
    this.guardRepathTimer = Math.max(0, this.guardRepathTimer - delta);
    this.guard.stateTimer = Math.max(0, this.guard.stateTimer - delta);
    this.guard.footstepTimer = Math.max(0, this.guard.footstepTimer - delta);
    this.guard.attackTimer = Math.max(0, this.guard.attackTimer - delta);
    this.guard.attackCooldown = Math.max(0, this.guard.attackCooldown - delta);
    this.guard.awarenessPulseTimer = Math.max(0, this.guard.awarenessPulseTimer - delta);
    const sight = this.getGuardSight();
    this.updateGuardAwareness(sight, delta);

    if (this.guard.state !== 'stunned') {
      if (sight.seesPlayer && sight.distance <= GUARD_CHASE_DISTANCE) {
        this.guard.state = 'chase';
        this.guard.stateTimer = BALANCE.guard.chaseMemorySeconds;
        this.guard.lastSeen.copy(this.player.pos);
      } else if (sight.seesPlayer) {
        if (this.guard.state !== 'chase') {
          this.guard.state = 'suspicious';
        }
        this.guard.stateTimer = BALANCE.guard.suspiciousDurationSeconds;
        this.guard.lastSeen.copy(this.player.pos);
      } else if (this.guard.state === 'chase' && this.guard.stateTimer === 0) {
        this.guard.state = 'return';
      }
    }

    switch (this.guard.state) {
      case 'patrol': {
        const target = this.guardWaypoints[this.guard.patrolIndex];
        if (this.guard.attackPhase === 'idle') {
          this.moveGuardTowards(target, GUARD_PATROL_SPEED, delta);
        } else {
          this.guard.velocity.set(0, 0, 0);
        }
        if (this.guard.pos.distanceTo(target) < 0.3) {
          this.advanceGuardPatrol();
        }
        break;
      }
      case 'suspicious': {
        if (this.guard.attackPhase === 'idle') {
          this.moveGuardTowards(this.guard.lastSeen, GUARD_SUSPICIOUS_SPEED, delta);
        } else {
          this.guard.velocity.set(0, 0, 0);
        }
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
        if (this.guard.attackPhase === 'idle') {
          this.moveGuardTowards(this.guard.lastSeen, GUARD_CHASE_SPEED, delta);
        } else {
          this.guard.velocity.set(0, 0, 0);
        }
        break;
      }
      case 'return': {
        const target = this.guardWaypoints[this.guard.patrolIndex];
        if (this.guard.attackPhase === 'idle') {
          this.moveGuardTowards(target, GUARD_RETURN_SPEED, delta);
        } else {
          this.guard.velocity.set(0, 0, 0);
        }
        if (this.guard.pos.distanceTo(target) < 0.4) {
          this.guard.state = 'patrol';
          this.guard.stalledFor = 0;
        }
        break;
      }
      case 'stunned': {
        this.guard.velocity.set(0, 0, 0);
        this.clearGuardPath();
        if (this.guard.stateTimer === 0) {
          this.guard.state = 'return';
        }
        break;
      }
    }

    if (sight.seesPlayer && sight.distance <= GUARD_NEAR_DETECTION && this.guard.state !== 'stunned') {
      this.guard.state = 'chase';
      this.guard.stateTimer = BALANCE.guard.chaseMemorySeconds;
      this.guard.lastSeen.copy(this.player.pos);
    }

    if (previousState !== this.guard.state && (this.guard.state === 'suspicious' || this.guard.state === 'chase')) {
      this.sound.play('alertTrigger');
    }

    this.updateGuardAttack(delta);
    this.updateGuardPatrolRecovery(delta);

    if (this.guard.velocity.lengthSq() > 0.4 && this.guard.footstepTimer === 0) {
      this.sound.play('guardFootstep');
      this.guard.footstepTimer = BALANCE.audio.guardFootstepIntervalSeconds;
    }

    this.handleGuardContact();
    this.guard.mesh.position.set(this.guard.pos.x, 0, this.guard.pos.z);
    this.guard.mesh.rotation.y = Math.atan2(this.guard.facing.x, this.guard.facing.z);

    const currentSightDistance = this.getGuardSightDistance();
    this.guardSightMesh.position.set(this.guard.pos.x, 0.04, this.guard.pos.z);
    this.guardSightMesh.rotation.set(-Math.PI / 2, this.guard.mesh.rotation.y, 0);
    this.guardSightMesh.scale.setScalar(currentSightDistance / GUARD_SIGHT_DISTANCE_TORCH);

    const guardMaterial = this.guard.body.material as THREE.MeshStandardMaterial;
    const attackPulse = Math.sin(performance.now() * 0.024) * 0.5 + 0.5;
    this.guard.body.scale.set(
      this.guard.attackPhase === 'windup' ? 1.08 : this.guard.attackPhase === 'recover' ? 0.96 : 1,
      this.guard.attackPhase === 'windup' ? 0.92 : this.guard.state === 'stunned' ? 0.88 : 1,
      this.guard.attackPhase === 'windup' ? 1.08 : 1,
    );
    const colorByState: Record<GuardState, number> = {
      patrol: 0xce526a,
      suspicious: 0xf0953e,
      chase: 0xf05a6b,
      return: 0x8a93af,
      stunned: 0x7bd8ff,
    };
    guardMaterial.color.setHex(colorByState[this.guard.state]);
    const guardFlashHex = this.guard.attackPhase === 'windup'
      ? (this.guard.attackTimer <= PLAYER_PARRY_WINDOW + 0.02 ? 0xfff0a6 : 0xff9f6e)
      : this.guard.attackPhase === 'recover'
        ? 0x7bd8ff
        : this.guard.state === 'stunned'
          ? 0x9ee7ff
          : colorByState[this.guard.state];
    guardMaterial.emissive.copy(this.guardFlashColor.setHex(guardFlashHex));
    guardMaterial.emissiveIntensity = this.guard.attackPhase === 'windup'
      ? 0.5 + attackPulse * 0.65
      : this.guard.attackPhase === 'recover'
        ? 0.26 + attackPulse * 0.2
        : this.guard.state === 'stunned'
          ? 0.42
          : 0.18;

    const sightColor = this.guard.attackPhase === 'windup'
      ? 0xffd16d
      : this.guard.attackPhase === 'strike'
        ? 0xff6b6b
        : sight.seesPlayer
          ? 0xff6b6b
          : this.guard.state === 'chase' || this.guard.state === 'suspicious'
            ? 0xf0a93e
            : 0xeac76a;
    this.guardSightMaterial.color.setHex(sightColor);
    this.guardSightMaterial.opacity = this.guard.attackPhase === 'windup'
      ? 0.34
      : sight.seesPlayer
        ? 0.3
        : this.guard.state === 'chase'
          ? 0.24
          : 0.16;
  }

  private updateWorldActors(delta: number): void {
    if (this.weapon.active) {
      this.weapon.mesh.rotation.y += delta * 1.4;
      this.weapon.mesh.position.y = this.weapon.pos.y + Math.sin(performance.now() * 0.0032) * 0.05;
    }

    for (const note of this.notePickups) {
      if (!note.active) continue;
      note.mesh.rotation.y += delta * 0.8;
      note.mesh.position.y = note.pos.y + Math.sin(performance.now() * 0.0025 + note.pos.x) * 0.03;
    }

    for (const prisoner of this.prisoners) {
      prisoner.mesh.visible = prisoner.active;
      if (!prisoner.active) continue;
      prisoner.mesh.rotation.y = Math.sin(performance.now() * 0.0012 + prisoner.pos.x) * 0.12;
    }

    if (this.key.active) {
      this.key.mesh.rotation.y += delta * 1.7;
      this.key.mesh.position.y = this.key.pos.y + Math.sin(performance.now() * 0.003) * 0.04;
    }

    if (this.torchPickup.active) {
      this.torchPickup.mesh.rotation.y += delta * 0.9;
      this.torchPickup.mesh.position.y = this.torchPickup.pos.y + Math.sin(performance.now() * 0.0035) * 0.05;
    }

    if (!this.player.missionComplete && !this.door.locked && this.isInsideRect(this.player.pos.x, this.player.pos.z, this.exitZone)) {
      if (!this.wardenEncounter.cleared) {
        this.setMessage('The gate is open, but the Warden still owns the lane. Stagger him first.');
      } else {
        this.player.missionComplete = true;
        this.enterVictoryState('Exit gate breached. Warden beaten. Prison slice clear.');
      }
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
    if (this.weapon.active && this.player.pos.distanceTo(this.weapon.pos) <= 1.45) {
      this.weapon.active = false;
      this.weapon.mesh.visible = false;
      this.player.hasWeapon = true;
      this.objectiveHints.add('weapon');
      this.sound.play('keyPickup');
      this.setMessage('Confiscated shiv recovered. Bare-handed flailing upgrades into real combat.');
      return;
    }

    for (const note of this.notePickups) {
      if (note.active && this.player.pos.distanceTo(note.pos) <= 1.35) {
        note.active = false;
        note.mesh.visible = false;
        this.objectiveHints.add('frame');
        this.setMessage(`${note.title}: ${note.text}`);
        return;
      }
    }

    for (const prisoner of this.prisoners) {
      if (prisoner.active && this.player.pos.distanceTo(prisoner.pos) <= 1.7) {
        this.handlePrisonerInteraction(prisoner);
        return;
      }
    }

    if (this.torchPickup.active && this.player.pos.distanceTo(this.torchPickup.pos) <= BALANCE.torch.interactDistance) {
      this.torchPickup.active = false;
      this.player.hasTorch = true;
      this.player.torchOn = false;
      this.torchPickup.mesh.visible = false;
      this.sound.play('torchPickup');
      this.setMessage('Torch recovered. Q toggles it, but the extra light burns your timer down faster.');
      return;
    }

    if (this.key.active && this.player.pos.distanceTo(this.key.pos) <= 1.5) {
      this.key.active = false;
      this.player.hasKey = true;
      this.key.mesh.visible = false;
      this.objectiveHints.add('key');
      this.sound.play('keyPickup');
      this.setMessage('Key secured. Tiny chaos, maximum usefulness.');
      return;
    }

    const doorDistance = this.player.pos.distanceTo(this.door.pos);
    if (this.door.locked && this.player.hasKey && doorDistance <= 1.75) {
      this.unlockDoor();
      this.setMessage('Gate unlocked. The exit chamber is finally open.');
      return;
    }

    if (this.door.locked && doorDistance <= 1.75) {
      this.setMessage('Locked. The key is somewhere past the barracks and kennel edge.');
    }
  }

  private unlockDoor(): void {
    this.door.locked = false;
    this.door.mesh.visible = false;
    this.objectiveHints.add('locked-exit');
    this.sound.play('doorUnlock');
    this.startWardenEncounter();
  }

  private handlePrisonerInteraction(prisoner: PrisonerState): void {
    prisoner.interacted = true;

    switch (prisoner.role) {
      case 'helper':
        this.player.health = Math.min(PLAYER_MAX_HEALTH, this.player.health + 1);
        this.objectiveHints.add('weapon');
        this.objectiveHints.add('key');
        this.setMessage('Helper: "Barracks stash holds a shiv. Brass key sits by the kennel rail. Also? You were framed."');
        break;
      case 'coward':
        this.objectiveHints.add('kennel');
        this.guard.lastSeen.copy(prisoner.pos);
        this.guard.state = 'suspicious';
        this.guard.stateTimer = BALANCE.guard.suspiciousDurationSeconds;
        this.sound.play('alertTrigger');
        this.setMessage('Coward: "If the lantern dips, his swing lands a heartbeat later. Block on the flash, not the shout."');
        break;
      case 'informant':
        this.objectiveHints.add('key');
        this.objectiveHints.add('locked-exit');
        this.objectiveHints.add('frame');
        this.setMessage('Informant: "Warden forged the seal after intake. Get the key, open the gate, find the magistrate ledger."');
        break;
      case 'hostile':
        if (!this.player.hasWeapon) {
          this.player.health = Math.max(0, this.player.health - 1);
          this.guard.lastSeen.copy(prisoner.pos);
          this.guard.state = 'suspicious';
          this.guard.stateTimer = BALANCE.guard.suspiciousDurationSeconds;
          this.sound.play('alertTrigger');
          this.setMessage('Hostile prisoner slams you into the wall. Bring a weapon next time.');
        } else {
          prisoner.active = false;
          prisoner.mesh.visible = false;
          this.objectiveHints.add('key');
          this.setMessage('A flash of steel ends the argument. The hostile points toward the brass key before backing off.');
        }
        break;
      case 'silent':
        this.objectiveHints.add('frame');
        this.objectiveHints.add('locked-exit');
        this.setMessage('The silent prisoner presses a broken court seal into your hand. Same crest. Wrong wax. You were set up — and the Warden always dips his lantern before the slow swing.');
        break;
    }
  }

  private resolveAttack(): void {
    if (this.tryHitHound()) {
      return;
    }

    if (!this.player.hasWeapon) {
      const toGuardBare = this.guard.pos.clone().sub(this.player.pos);
      if (toGuardBare.length() <= BALANCE.player.attackReach) {
        this.guard.state = this.guard.state === 'chase' ? 'chase' : 'suspicious';
        this.guard.stateTimer = Math.max(this.guard.stateTimer, BALANCE.guard.suspiciousDurationSeconds);
        this.guard.lastSeen.copy(this.player.pos);
        this.setMessage('Bare hands only annoy the guard. Find something sharper in the barracks.');
      } else {
        this.setMessage('A nervous swing. You need reach and steel.');
      }
      return;
    }

    const toGuard = this.guard.pos.clone().sub(this.player.pos);
    const distance = toGuard.length();
    if (distance > BALANCE.player.attackReach) {
      this.setMessage('Slash! Close, but no cigar.');
      return;
    }

    toGuard.y = 0;
    toGuard.normalize();
    const aimDot = THREE.MathUtils.clamp(this.player.facing.dot(toGuard), -1, 1);
    const angle = Math.acos(aimDot);
    if (angle <= THREE.MathUtils.degToRad(BALANCE.player.attackArcDeg) && this.guard.state !== 'stunned') {
      this.guard.state = 'stunned';
      this.guard.stateTimer = GUARD_STUN_SECONDS;
      this.guard.attackPhase = 'idle';
      this.guard.attackTimer = 0;
      this.guard.attackCooldown = 0.55;
      this.guard.velocity.set(0, 0, 0);
      this.sound.play('parrySuccess');
      this.setMessage('Clean hit. Guard staggered.');
      return;
    }

    this.setMessage('Your swing whiffs past the helmet.');
  }

  private tryHitHound(): boolean {
    if (!this.houndReleased || this.hound.state === 'down' || this.hound.state === 'idle') {
      return false;
    }

    if (!this.player.hasWeapon) {
      this.setMessage('Punching the hound is a bold little disaster. Bring the shiv.');
      return true;
    }

    const toHound = this.hound.pos.clone().sub(this.player.pos);
    const distance = toHound.length();
    if (distance > BALANCE.player.attackReach) {
      return false;
    }

    toHound.y = 0;
    toHound.normalize();
    const aimDot = THREE.MathUtils.clamp(this.player.facing.dot(toHound), -1, 1);
    const angle = Math.acos(aimDot);
    if (angle > THREE.MathUtils.degToRad(BALANCE.player.attackArcDeg)) {
      return false;
    }

    this.hound.health -= 1;
    this.hound.lastSeen.copy(this.player.pos);
    if (this.hound.health <= 0) {
      this.hound.state = 'reset';
      this.hound.stateTimer = BALANCE.hound.recoverSeconds;
      this.hound.mesh.visible = true;
      this.setMessage('Hound dropped. It will drag itself back to the kennel if you keep moving.');
    } else {
      this.hound.state = 'chase';
      this.hound.stateTimer = BALANCE.hound.chaseMemorySeconds;
      this.setMessage('You clipped the hound, but it is still coming.');
    }
    return true;
  }

  private updateHound(delta: number): void {
    this.hound.attackCooldown = Math.max(0, this.hound.attackCooldown - delta);
    this.hound.damageCooldown = Math.max(0, this.hound.damageCooldown - delta);
    this.hound.stateTimer = Math.max(0, this.hound.stateTimer - delta);
    this.hound.growlTimer = Math.max(0, this.hound.growlTimer - delta);
    this.hound.barkTimer = Math.max(0, this.hound.barkTimer - delta);

    if (!this.houndReleased || this.player.missionComplete) {
      this.hound.mesh.visible = false;
      this.houndSightMaterial.opacity = 0;
      this.warningLight.intensity = 0;
      return;
    }

    this.hound.mesh.visible = true;
    const sight = this.getHoundSight();
    if (sight.seesPlayer) {
      this.hound.lastSeen.copy(this.player.pos);
    }

    switch (this.hound.state) {
      case 'released':
        this.warningLight.intensity = BALANCE.hound.warningLightIntensity;
        this.moveHoundTowards(this.hound.releaseTarget, BALANCE.hound.releasedSpeed, delta);
        if (this.hound.stateTimer === 0 || this.hound.pos.distanceTo(this.hound.releaseTarget) < 0.6) {
          this.hound.state = 'search';
          this.hound.stateTimer = BALANCE.hound.searchDurationSeconds;
        }
        break;
      case 'search':
        this.warningLight.intensity = 0.8;
        if (sight.seesPlayer) {
          this.triggerHoundChase();
        } else {
          this.moveHoundTowards(this.hound.lastSeen, BALANCE.hound.searchSpeed, delta);
          if (this.hound.stateTimer === 0) {
            this.hound.state = 'reset';
          }
        }
        break;
      case 'chase':
        this.warningLight.intensity = 1.1;
        if (sight.seesPlayer) {
          this.hound.stateTimer = BALANCE.hound.chaseMemorySeconds;
          this.playHoundBark();
        } else if (this.hound.stateTimer === 0) {
          this.hound.state = 'search';
          this.hound.stateTimer = BALANCE.hound.searchDurationSeconds;
        }
        this.moveHoundTowards(this.hound.lastSeen, BALANCE.hound.chaseSpeed, delta);
        if (this.hound.pos.distanceTo(this.player.pos) <= BALANCE.hound.attackRange && this.hound.attackCooldown === 0) {
          this.hound.state = 'attack';
          this.hound.stateTimer = BALANCE.hound.attackDurationSeconds;
          this.hound.attackCooldown = BALANCE.hound.attackCooldownSeconds;
        }
        break;
      case 'attack':
        this.warningLight.intensity = 1.2;
        this.hound.velocity.set(0, 0, 0);
        if (this.hound.stateTimer === 0) {
          this.hound.state = sight.seesPlayer ? 'chase' : 'search';
          this.hound.stateTimer = sight.seesPlayer ? BALANCE.hound.chaseMemorySeconds : BALANCE.hound.searchDurationSeconds;
        }
        break;
      case 'reset':
      case 'down':
        this.warningLight.intensity = 0.45;
        this.moveHoundTowards(this.houndSpawn, BALANCE.hound.resetSpeed, delta);
        if (this.hound.pos.distanceTo(this.houndSpawn) <= BALANCE.hound.resetTolerance) {
          this.resetHoundToKennel();
        }
        break;
      case 'idle':
      default:
        this.warningLight.intensity = 0;
        this.hound.velocity.set(0, 0, 0);
        break;
    }

    if ((this.hound.state === 'released' || this.hound.state === 'search') && sight.seesPlayer) {
      this.triggerHoundChase();
    }

    if (this.hound.growlTimer === 0 && this.hound.state !== 'idle') {
      this.sound.play('houndGrowl');
      this.hound.growlTimer = BALANCE.audio.houndGrowlIntervalSeconds;
    }

    this.handleHoundContact();
    this.hound.mesh.position.set(this.hound.pos.x, 0, this.hound.pos.z);
    this.hound.mesh.rotation.y = Math.atan2(this.hound.facing.x, this.hound.facing.z);
    this.houndSightMesh.position.set(this.hound.pos.x, 0.04, this.hound.pos.z);
    this.houndSightMesh.rotation.set(-Math.PI / 2, this.hound.mesh.rotation.y, 0);
    this.houndSightMesh.scale.setScalar(BALANCE.hound.sightDistance / GUARD_SIGHT_DISTANCE_TORCH);
    this.houndSightMaterial.opacity = this.hound.state === 'idle' ? 0 : sight.seesPlayer ? 0.24 : 0.12;
    this.warningLight.position.copy(this.hound.pos).add(new THREE.Vector3(0, 0.35, 0));
  }

  private releaseHound(): void {
    if (this.houndReleased) {
      return;
    }

    this.houndReleased = true;
    this.hound.health = BALANCE.hound.maxHealth;
    this.hound.pos.copy(this.houndSpawn);
    this.hound.lastSeen.copy(this.player.pos);
    this.hound.state = 'released';
    this.hound.stateTimer = BALANCE.hound.warningSeconds;
    this.hound.mesh.visible = true;
    this.sound.play('alertTrigger');
    this.sound.play('houndBark');
    this.setMessage('Timer expired. Kennel breach — hound released.');
  }

  private triggerHoundChase(): void {
    if (this.hound.state !== 'chase') {
      this.sound.play('alertTrigger');
      this.playHoundBark();
    }
    this.hound.state = 'chase';
    this.hound.stateTimer = BALANCE.hound.chaseMemorySeconds;
  }

  private playHoundBark(): void {
    if (this.hound.barkTimer > 0) {
      return;
    }
    this.sound.play('houndBark');
    this.hound.barkTimer = BALANCE.audio.barkCooldownSeconds;
  }

  private getHoundSight(): { seesPlayer: boolean; distance: number } {
    const toPlayer = this.player.pos.clone().sub(this.hound.pos);
    toPlayer.y = 0;
    const distance = toPlayer.length();
    if (distance > BALANCE.hound.sightDistance) {
      return { seesPlayer: false, distance };
    }

    const direction = toPlayer.normalize();
    const dot = THREE.MathUtils.clamp(this.hound.facing.dot(direction), -1, 1);
    const angle = Math.acos(dot);
    const blocked = this.isLineBlocked(this.hound.pos.x, this.hound.pos.z, this.player.pos.x, this.player.pos.z);
    const seesPlayer = (angle <= THREE.MathUtils.degToRad(BALANCE.hound.fovDeg) / 2 && !blocked) || distance <= BALANCE.hound.nearDetection;
    return { seesPlayer, distance };
  }

  private moveHoundTowards(target: THREE.Vector3, speed: number, delta: number): void {
    const velocity = target.clone().sub(this.hound.pos);
    velocity.y = 0;
    if (velocity.lengthSq() <= 0.0001) {
      this.hound.velocity.set(0, 0, 0);
      return;
    }

    velocity.normalize();
    this.hound.facing.lerp(velocity, 0.3).normalize();
    this.hound.velocity.copy(velocity.multiplyScalar(speed));
    this.moveBody(this.hound.pos, this.hound.velocity, HOUND_RADIUS, delta);
  }

  private handleHoundContact(): void {
    const distance = this.hound.pos.distanceTo(this.player.pos);
    if (distance > PLAYER_RADIUS + HOUND_RADIUS + 0.12 || this.hound.state === 'idle' || this.hound.state === 'down') {
      return;
    }

    if (this.player.damageCooldown > 0 || this.player.state === 'dodge' || this.hound.damageCooldown > 0) {
      return;
    }

    this.player.health -= BALANCE.hound.damage;
    this.player.damageCooldown = BALANCE.hound.damageCooldownSeconds;
    this.hound.damageCooldown = BALANCE.hound.damageCooldownSeconds;
    const knockback = this.player.pos.clone().sub(this.hound.pos).setY(0).normalize().multiplyScalar(BALANCE.player.knockbackDistance);
    this.moveBody(this.player.pos, knockback, PLAYER_RADIUS, 1);
    this.playHoundBark();
    this.setMessage(`The hound tears through your guard. Health at ${Math.max(this.player.health, 0)}.`);
  }

  private resetHoundToKennel(): void {
    this.houndReleased = false;
    this.hound.state = 'idle';
    this.hound.velocity.set(0, 0, 0);
    this.hound.health = BALANCE.hound.maxHealth;
    this.hound.mesh.visible = false;
    this.warningLight.intensity = 0;
  }


  private updateGuardAwareness(sight: { seesPlayer: boolean; distance: number }, delta: number): void {
    const targetAwareness = this.guard.state === 'chase'
      ? 1
      : sight.seesPlayer
        ? 0.72
        : this.guard.state === 'suspicious'
          ? 0.6
          : 0;
    const rate = targetAwareness > this.guard.awarenessLevel ? 2.4 : 1.6;
    this.guard.awarenessLevel = THREE.MathUtils.lerp(this.guard.awarenessLevel, targetAwareness, Math.min(1, delta * rate));

    if (this.guard.awarenessPulseTimer === 0 && (this.guard.state === 'suspicious' || this.guard.state === 'chase' || sight.seesPlayer)) {
      this.sound.play('suspicionPulse');
      this.guard.awarenessPulseTimer = this.guard.state === 'chase' ? 0.42 : 0.78;
    }
  }

  private startGuardAttack(): void {
    if (this.guard.state === 'stunned' || this.guard.attackPhase !== 'idle' || this.guard.attackCooldown > 0) {
      return;
    }

    this.guard.attackPhase = 'windup';
    this.guard.attackTimer = 0.56;
    this.guard.velocity.set(0, 0, 0);
    this.sound.play('attackWindup');
    this.setMessage(this.wardenEncounter.active
      ? 'Lantern dips. The Warden is loading the heavy swing.'
      : 'Guard shoulders in. Lantern dips before the swing.');
  }

  private updateGuardAttack(delta: number): void {
    const distance = this.guard.pos.distanceTo(this.player.pos);
    const inAttackRange = distance <= PLAYER_RADIUS + GUARD_RADIUS + 0.82;
    const canAttack = this.guard.state !== 'stunned' && this.guard.state !== 'patrol' && !this.player.missionComplete;

    if (canAttack && inAttackRange && this.guard.attackPhase === 'idle' && this.guard.attackCooldown === 0) {
      this.startGuardAttack();
    }

    if (this.guard.attackPhase === 'windup') {
      if (this.guard.attackTimer <= PLAYER_PARRY_WINDOW + 0.02 && this.guard.attackTimer > PLAYER_PARRY_WINDOW - delta) {
        this.sound.play('parryWindow');
      }
      if (this.guard.attackTimer === 0) {
        this.guard.attackPhase = 'strike';
        this.guard.attackTimer = 0.12;
        this.sound.play('attackSwing');
        this.handleGuardContact();
      }
      return;
    }

    if (this.guard.attackPhase === 'strike' && this.guard.attackTimer === 0) {
      this.guard.attackPhase = 'recover';
      this.guard.attackTimer = 0.48;
      this.guard.attackCooldown = 0.3;
      this.sound.play('attackRecover');
      if (this.guard.state !== 'stunned' && !this.player.missionComplete) {
        this.setMessage(this.wardenEncounter.active ? 'Swing spent. He needs a beat to recover.' : 'Swing spent. There is your opening.');
      }
      return;
    }

    if (this.guard.attackPhase === 'recover' && this.guard.attackTimer === 0) {
      this.guard.attackPhase = 'idle';
    }
  }

  private handleGuardContact(): void {
    const distance = this.guard.pos.distanceTo(this.player.pos);
    if (distance > PLAYER_RADIUS + GUARD_RADIUS + 0.4 || this.guard.state === 'stunned' || this.player.missionComplete) {
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
        this.guard.attackPhase = 'idle';
        this.guard.attackTimer = 0;
        this.guard.attackCooldown = 0.7;
        this.guard.velocity.set(0, 0, 0);
        this.sound.play('parrySuccess');
        this.setMessage('Perfect parry! Sparks fly, the guard buckles, and the lane is yours.');
      } else {
        this.sound.play('attackRecover');
        this.setMessage('Block held. Good save, but the parry flash was earlier.');
      }
      this.player.damageCooldown = 0.4;
      return;
    }

    this.player.health -= 1;
    this.player.damageCooldown = 1;
    this.guard.attackCooldown = 0.55;
    this.guard.attackPhase = 'recover';
    this.guard.attackTimer = Math.max(this.guard.attackTimer, 0.36);
    const knockback = guardToPlayer.multiplyScalar(2.3);
    this.moveBody(this.player.pos, knockback, PLAYER_RADIUS, 1);
    this.setMessage(`Heavy hit. Health at ${Math.max(this.player.health, 0)}.`);
  }

  private respawnPlayer(): void {
    this.player.health = PLAYER_MAX_HEALTH;
    this.player.pos.copy(this.spawnPoint);
    this.player.velocity.set(0, 0, 0);
    this.player.state = 'idle';
    this.player.stateTimer = 0;
    this.player.attackCooldown = 0;
    this.player.dodgeCooldown = 0;
    this.player.damageCooldown = 0;
    this.player.blockTimer = 0;
    this.player.hasKey = false;
    this.player.hasTorch = false;
    this.player.hasWeapon = false;
    this.player.torchOn = false;
    this.player.missionComplete = false;
    this.countdownRemaining = BALANCE.countdown.startSeconds;
    this.weapon.active = true;
    this.weapon.mesh.visible = true;
    this.weapon.mesh.position.copy(this.weapon.pos);
    this.key.active = true;
    this.key.mesh.visible = true;
    this.torchPickup.active = true;
    this.torchPickup.mesh.visible = true;
    for (const note of this.notePickups) {
      note.active = true;
      note.mesh.visible = true;
      note.mesh.position.copy(note.pos);
    }
    for (const prisoner of this.prisoners) {
      prisoner.active = true;
      prisoner.interacted = false;
      prisoner.mesh.visible = true;
      prisoner.mesh.position.set(prisoner.pos.x, 0, prisoner.pos.z);
    }
    this.door.locked = true;
    this.door.mesh.visible = true;
    this.guard.pos.copy(this.guardSpawn);
    this.guard.velocity.set(0, 0, 0);
    this.guard.state = 'patrol';
    this.guard.stateTimer = 0;
    this.guard.patrolIndex = 0;
    this.guard.lastPatrolPos.copy(this.guard.pos);
    this.guard.stalledFor = 0;
    this.guard.attackPhase = 'idle';
    this.guard.attackTimer = 0;
    this.guard.attackCooldown = 0;
    this.guard.awarenessLevel = 0;
    this.guard.awarenessPulseTimer = 0;
    this.clearGuardPath();
    this.hound.pos.copy(this.houndSpawn);
    this.hound.velocity.set(0, 0, 0);
    this.hound.health = BALANCE.hound.maxHealth;
    this.hound.state = 'idle';
    this.hound.mesh.visible = false;
    this.houndReleased = false;
    this.warningLight.intensity = 0;
    this.wardenEncounter.active = false;
    this.wardenEncounter.cleared = false;
    this.wardenEncounter.lightsOutTimer = 0;
    this.wardenEncounter.torchJamTimer = 0;
    this.ambientLight.intensity = 0.24;
    this.doorLight.intensity = 1.1;
    this.discoveredRooms.clear();
    this.discoveredRooms.add('cell-block');
    this.objectiveHints.clear();
    this.objectiveHints.add('locked-exit');
    this.currentRoomId = 'cell-block';
    this.setMessage('Dragged back to the wing entrance. Try a sneakier route.');
  }

  private getGuardSightDistance(): number {
    const baseSight = this.player.hasTorch && this.player.torchOn ? GUARD_SIGHT_DISTANCE_TORCH : GUARD_SIGHT_DISTANCE;
    return this.player.hasTorch && this.player.torchOn ? baseSight * BALANCE.torch.guardExposureMultiplier : baseSight;
  }

  private getGuardSight(): { seesPlayer: boolean; distance: number } {
    const toPlayer = this.player.pos.clone().sub(this.guard.pos);
    toPlayer.y = 0;
    const distance = toPlayer.length();
    const detectionDistance = this.getGuardSightDistance();
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
    const navigationTarget = this.getGuardNavigationTarget(target);
    const velocity = navigationTarget.clone().sub(this.guard.pos);
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

  private getGuardNavigationTarget(target: THREE.Vector3): THREE.Vector3 {
    const start = { x: this.guard.pos.x, z: this.guard.pos.z };
    const destination = { x: target.x, z: target.z };
    const walls = this.getNavigationWalls();

    if (hasClearPath(start, destination, walls, GUARD_RADIUS)) {
      this.clearGuardPath();
      return target;
    }

    const targetMoved = this.guardPathTarget.distanceToSquared(target) > 0.36;
    if (targetMoved || this.guardRepathTimer === 0 || this.guardPath.length === 0) {
      this.guardPath = findGuardPath({
        start,
        target: destination,
        walls,
        radius: GUARD_RADIUS,
        bounds: { minX: 0, maxX: WORLD_WIDTH, minZ: 0, maxZ: WORLD_DEPTH },
        step: GUARD_NAV_STEP,
      });
      this.guardPathTarget.copy(target);
      this.guardRepathTimer = this.guard.state === 'chase' ? 0.18 : 0.4;
    }

    while (this.guardPath.length > 0) {
      const next = this.guardPath[0];
      const distance = Math.hypot(next.x - this.guard.pos.x, next.z - this.guard.pos.z);
      if (distance > 0.3) {
        break;
      }
      this.guardPath.shift();
    }

    if (this.guardPath.length === 0) {
      return target;
    }

    const waypoint = this.guardPath[0];
    return this.tmpVecA.set(waypoint.x, target.y, waypoint.z);
  }

  private getNavigationWalls(): NavigationRect[] {
    const walls = this.walls.map<NavigationRect>((wall) => ({
      minX: wall.minX,
      maxX: wall.maxX,
      minZ: wall.minZ,
      maxZ: wall.maxZ,
    }));

    if (this.door.locked) {
      walls.push(this.doorCollisionRect);
    }

    return walls;
  }

  private clearGuardPath(): void {
    this.guardPath = [];
    this.guardRepathTimer = 0;
    this.guardPathTarget.set(Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY);
  }

  private advanceGuardPatrol(): void {
    this.guard.patrolIndex = (this.guard.patrolIndex + 1) % this.guardWaypoints.length;
    this.guard.stalledFor = 0;
    this.guard.lastPatrolPos.copy(this.guard.pos);
  }

  private updateGuardPatrolRecovery(delta: number): void {
    const movedDistance = this.guard.pos.distanceTo(this.guard.lastPatrolPos);
    this.guard.lastPatrolPos.copy(this.guard.pos);

    if (this.guard.state !== 'patrol' && this.guard.state !== 'return') {
      this.guard.stalledFor = 0;
      return;
    }

    const target = this.guardWaypoints[this.guard.patrolIndex];
    const distanceToTarget = this.guard.pos.distanceTo(target);
    if (distanceToTarget < 0.45 || this.guard.velocity.lengthSq() < 0.01) {
      this.guard.stalledFor = 0;
      return;
    }

    if (movedDistance < 0.015) {
      this.guard.stalledFor += delta;
    } else {
      this.guard.stalledFor = 0;
    }

    if (this.guard.stalledFor < 0.45) {
      return;
    }

    this.guard.state = 'patrol';
    this.advanceGuardPatrol();
    this.guard.velocity.set(0, 0, 0);
  }

  private moveBody(position: THREE.Vector3, velocity: THREE.Vector3, radius: number, delta: number): void {
    const next = moveCircle(position, velocity, radius, delta, this.getCollisionRects());
    position.x = next.x;
    position.z = next.z;
    position.y = PLAYER_HEIGHT * 0.5;
  }

  private getCollisionRects(): CollisionRect[] {
    const walls = this.walls.map<CollisionRect>((wall) => ({
      minX: wall.minX,
      maxX: wall.maxX,
      minZ: wall.minZ,
      maxZ: wall.maxZ,
    }));

    if (this.door.locked) {
      walls.push(this.doorCollisionRect);
    }

    return walls;
  }

  private isInsideRect(x: number, z: number, rect: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean {
    return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
  }

  private updateRoomDiscovery(): void {
    const room = this.rooms.find((candidate) => this.isInsideRect(this.player.pos.x, this.player.pos.z, candidate.rect));
    if (!room) {
      return;
    }

    this.currentRoomId = room.id;
    if (!this.discoveredRooms.has(room.id)) {
      this.discoveredRooms.add(room.id);
      this.setMessage(room.discoverMessage);
    }
  }

  private drawMinimap(): void {
    const canvas = this.ui.minimapCanvas;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(5, 8, 14, 0.94)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    const pad = 18;
    const scaleX = (canvas.width - pad * 2) / WORLD_WIDTH;
    const scaleY = (canvas.height - pad * 2) / WORLD_DEPTH;
    const mapX = (x: number) => pad + x * scaleX;
    const mapY = (z: number) => pad + z * scaleY;

    for (const room of this.rooms) {
      if (!this.discoveredRooms.has(room.id)) {
        continue;
      }

      const width = (room.rect.maxX - room.rect.minX) * scaleX;
      const height = (room.rect.maxZ - room.rect.minZ) * scaleY;
      context.fillStyle = `#${room.color.toString(16).padStart(6, '0')}`;
      context.globalAlpha = 0.28;
      context.fillRect(mapX(room.rect.minX), mapY(room.rect.minZ), width, height);
      context.globalAlpha = 1;
      context.strokeStyle = 'rgba(230, 236, 247, 0.55)';
      context.lineWidth = 1.2;
      context.strokeRect(mapX(room.rect.minX), mapY(room.rect.minZ), width, height);
      context.fillStyle = 'rgba(241, 245, 255, 0.86)';
      context.font = '10px IBM Plex Mono, monospace';
      context.fillText(room.minimapLabel, mapX(room.rect.minX) + 4, mapY(room.rect.minZ) + 12);
    }

    for (const door of this.minimapDoors) {
      if (!door.rooms.some((roomId) => this.discoveredRooms.has(roomId))) {
        continue;
      }

      context.strokeStyle = this.door.locked && door.rooms.includes('exit-gate') ? '#ffb870' : 'rgba(133, 226, 180, 0.95)';
      context.lineWidth = 2;
      context.beginPath();
      if (door.axis === 'vertical') {
        context.moveTo(mapX(door.x), mapY(door.z - 0.9));
        context.lineTo(mapX(door.x), mapY(door.z + 0.9));
      } else {
        context.moveTo(mapX(door.x - 0.9), mapY(door.z));
        context.lineTo(mapX(door.x + 0.9), mapY(door.z));
      }
      context.stroke();
    }

    const drawMarker = (x: number, z: number, color: string, label: string): void => {
      context.fillStyle = color;
      context.beginPath();
      context.arc(mapX(x), mapY(z), 4.5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = 'rgba(255, 255, 255, 0.9)';
      context.font = '9px IBM Plex Mono, monospace';
      context.fillText(label, mapX(x) + 6, mapY(z) - 6);
    };

    if (this.objectiveHints.has('weapon') || this.discoveredRooms.has('barracks-key-room')) {
      drawMarker(this.weapon.pos.x, this.weapon.pos.z, '#7de7ff', this.weapon.active ? 'shiv' : 'armed');
    }
    if (this.objectiveHints.has('key') || this.discoveredRooms.has('barracks-key-room') || this.discoveredRooms.has('kennel-edge')) {
      drawMarker(this.key.pos.x, this.key.pos.z, '#ffd65c', this.key.active ? 'key' : 'key ✓');
    }
    if (this.objectiveHints.has('frame')) {
      drawMarker(13.4, 8.4, '#c8a8ff', 'proof');
    }
    if (this.objectiveHints.has('kennel')) {
      drawMarker(24.8, 14.2, '#ff8c78', 'kennel');
    }

    drawMarker(this.player.pos.x, this.player.pos.z, '#82ffa7', 'you');
  }

  private getGuardCombatRead(): string {
    const attackLabel: Record<GuardAttackPhase, string> = {
      idle: this.guard.state === 'stunned' ? 'stunned' : this.guard.state === 'return' ? 'recovering lane' : 'looking for an opening',
      windup: this.player.blockTimer > 0.06 ? 'wind-up — parry flash live' : 'wind-up — lantern dipping',
      strike: 'strike committed',
      recover: 'recovering after swing',
    };
    return attackLabel[this.guard.attackPhase];
  }

  private getAwarenessReadout(): string {
    const percent = Math.round(this.guard.awarenessLevel * 100);
    if (this.guard.state === 'chase') {
      return `CHASE ${percent}% • sprint or break line now`;
    }
    if (this.guard.state === 'suspicious') {
      return `SUSPICION ${percent}% • cone hot, footsteps louder`;
    }
    if (percent >= 55) {
      return `WATCH ${percent}% • one more peek will spike it`;
    }
    if (percent >= 20) {
      return `MURMUR ${percent}% • you are brushing the cone`;
    }
    return 'CALM 0% • keep the torch low and stay off the cone';
  }

  private updateUi(): void {
    const guardLabel: Record<GuardState, string> = {
      patrol: this.wardenEncounter.active || this.wardenEncounter.cleared ? 'warden stalking' : 'patrolling',
      suspicious: this.wardenEncounter.active || this.wardenEncounter.cleared ? 'warden suspicious' : 'suspicious',
      chase: this.wardenEncounter.active || this.wardenEncounter.cleared ? 'warden charging' : 'chasing',
      return: this.wardenEncounter.active || this.wardenEncounter.cleared ? 'warden resetting' : 'resetting',
      stunned: this.wardenEncounter.active || this.wardenEncounter.cleared ? 'warden staggered' : 'stunned',
    };
    const houndLabel: Record<HoundState, string> = {
      idle: 'kenneled',
      released: 'released',
      search: 'searching',
      chase: 'chasing',
      attack: 'attacking',
      reset: 'resetting',
      down: 'down',
    };
    const remainingSeconds = Math.ceil(this.countdownRemaining);
    const minutes = Math.floor(remainingSeconds / 60)
      .toString()
      .padStart(2, '0');
    const seconds = (remainingSeconds % 60).toString().padStart(2, '0');
    const minimapVisible = this.isActionPressed('minimap') || this.player.missionComplete;
    const roomName = this.rooms.find((room) => room.id === this.currentRoomId)?.name ?? 'Unknown';

    this.drawMinimap();
    this.ui.minimapFrame.classList.toggle('visible', minimapVisible);

    this.ui.hud.textContent = `HP ${'♥'.repeat(Math.max(this.player.health, 0))}${'·'.repeat(Math.max(0, PLAYER_MAX_HEALTH - this.player.health))}  •  Weapon ${this.player.hasWeapon ? 'shiv' : 'bare'}  •  Key ${this.player.hasKey ? 'yes' : 'no'}  •  Torch ${this.player.hasTorch ? (this.player.torchOn ? 'lit' : 'carried') : 'missing'}  •  Dodge ${this.player.dodgeCooldown > 0 ? this.player.dodgeCooldown.toFixed(1) : 'ready'}`;
    this.ui.status.textContent = `Guard ${guardLabel[this.guard.state]}  •  Hound ${houndLabel[this.hound.state]}  •  Player ${this.player.state}`;
    this.ui.timer.textContent = `KENNEL TIMER ${minutes}:${seconds}${this.player.hasTorch && this.player.torchOn ? '  •  drain x1.65' : ''}`;
    this.ui.timer.className = `timer${remainingSeconds <= BALANCE.countdown.criticalWarningSeconds ? ' critical' : remainingSeconds <= BALANCE.countdown.lowWarningSeconds ? ' warning' : ''}`;
    this.ui.message.textContent = this.messageTimer > 0 ? this.message : '';
    this.ui.objective.textContent = this.player.missionComplete
      ? 'Exit gate breached — compact prison slice clear.'
      : this.wardenEncounter.active
        ? 'Finale: survive the blackout, bait the Warden into a bad swing, then take the gate.'
        : this.wardenEncounter.cleared
          ? 'Warden staggered — sprint through the open gate.'
          : `Room: ${roomName}  •  Objective: torch → shiv → key → unlock gate → beat the Warden`;
    this.ui.awareness.textContent = `Awareness ${this.getAwarenessReadout()}`;
    this.ui.awareness.className = `awareness state-${this.guard.state}`;
    this.ui.combat.textContent = `Combat ${this.getGuardCombatRead()}`;
    this.ui.combat.className = `combat-read phase-${this.guard.attackPhase}`;
    this.ui.prompt.textContent = this.getPromptText();
    this.ui.controls.textContent = `${this.getControlsSummary()}  •  ${this.getControlsSupportText()}  •  Press C any time for the remap screen.`;
    this.ui.centerHint.textContent = this.phase === 'playing'
      ? this.showingControls
        ? 'Controls open — choose a binding, then press a key.'
        : this.wardenEncounter.active
          ? `Warden finale live — ${this.player.blockTimer > 0.06 ? 'flash means parry now.' : this.guard.attackPhase === 'recover' ? 'swing spent — punish or run.' : 'watch the lantern dip.'}`
          : this.guard.state === 'suspicious' || this.guard.state === 'chase'
            ? 'Guard awareness is climbing — orange means suspicious, red means chase.'
            : 'Click to lock pointer. C opens controls. Mouse attack/block stay fixed.'
      : 'Press Enter or click Start slice.';

    const screenActive = this.phase !== 'playing' || this.showingControls;
    this.ui.overlay.classList.toggle('menu-active', screenActive);
    this.ui.screen.classList.toggle('visible', screenActive);

    if (this.showingControls) {
      this.ui.screenEyebrow.textContent = 'Controls';
      this.ui.screenTitle.textContent = 'Remap the keyboard';
      this.ui.screenBody.textContent = `${this.getControlsSummary()}\n\n${this.getControlsSupportText()}`;
      this.ui.controlsPanel.hidden = false;
      this.ui.startButton.hidden = true;
      this.ui.controlsButton.hidden = true;
      this.ui.backButton.hidden = false;
      this.ui.restartButton.hidden = true;
      this.ui.titleButton.hidden = this.controlsReturnPhase === 'title';
      return;
    }

    this.ui.controlsPanel.hidden = true;
    this.ui.backButton.hidden = true;

    if (this.phase === 'title') {
      this.ui.screenEyebrow.textContent = 'Vertical slice';
      this.ui.screenTitle.textContent = 'Dungeon Crawler';
      this.ui.screenBody.textContent = 'Break out of the prison wing, scavenge a torch, grab a shiv, steal the brass key, and survive the Warden at the gate.';
      this.ui.startButton.hidden = false;
      this.ui.controlsButton.hidden = false;
      this.ui.restartButton.hidden = true;
      this.ui.titleButton.hidden = true;
      return;
    }

    if (this.phase === 'death') {
      this.ui.screenEyebrow.textContent = 'Death';
      this.ui.screenTitle.textContent = 'Run collapsed';
      this.ui.screenBody.textContent = 'The prison won that exchange. Restart the slice, or hop back to the title screen and retune your keys.';
      this.ui.startButton.hidden = true;
      this.ui.controlsButton.hidden = false;
      this.ui.restartButton.hidden = false;
      this.ui.titleButton.hidden = false;
      return;
    }

    if (this.phase === 'victory') {
      this.ui.screenEyebrow.textContent = 'Victory';
      this.ui.screenTitle.textContent = 'Gate breached';
      this.ui.screenBody.textContent = 'You slipped the wing, broke the finale, and cleared the prison slice.';
      this.ui.startButton.hidden = true;
      this.ui.controlsButton.hidden = false;
      this.ui.restartButton.hidden = false;
      this.ui.titleButton.hidden = false;
      return;
    }
  }

  private getPromptText(): string {
    const interactLabel = `${this.formatBinding(this.bindings.interact)} or F`;
    if (this.weapon.active && this.player.pos.distanceTo(this.weapon.pos) <= 1.45) {
      return `Press ${interactLabel} to recover the confiscated shiv.`;
    }

    for (const note of this.notePickups) {
      if (note.active && this.player.pos.distanceTo(note.pos) <= 1.35) {
        return `Press ${interactLabel} to read ${note.title}.`;
      }
    }

    for (const prisoner of this.prisoners) {
      if (prisoner.active && this.player.pos.distanceTo(prisoner.pos) <= 1.7) {
        return `Press ${interactLabel} to deal with the ${prisoner.label.toLowerCase()} prisoner.`;
      }
    }

    if (this.torchPickup.active && this.player.pos.distanceTo(this.torchPickup.pos) <= BALANCE.torch.interactDistance) {
      return `Press ${interactLabel} to recover the torch.`;
    }

    if (this.key.active && this.player.pos.distanceTo(this.key.pos) <= 1.5) {
      return `Press ${interactLabel} to grab the brass key.`;
    }

    const doorDistance = this.player.pos.distanceTo(this.door.pos);
    if (doorDistance <= 1.75) {
      if (this.door.locked && this.player.hasKey) {
        return `Press ${interactLabel} to unlock the exit gate.`;
      }
      if (this.door.locked) {
        return 'Locked gate. The key is somewhere past the barracks and kennel edge.';
      }
      if (!this.wardenEncounter.cleared) {
        return 'Open gate, bad timing. Beat the Warden before you commit to the lane.';
      }
      return 'Exit gate is open. Slip through.';
    }

    if (!this.player.hasTorch) {
      return 'No torch. Start in the cell block and sweep the side halls.';
    }

    if (!this.player.hasWeapon) {
      return 'Torch found. Good. Now raid the barracks for something sharper than your fists.';
    }

    if (!this.player.hasKey) {
      return 'Shiv found. Now get the brass key before the kennel timer runs out.';
    }

    if (this.wardenEncounter.active) {
      return 'The Warden is active. Parry or shiv him into a stagger, then run.';
    }

    return this.houndReleased ? 'The hound is loose. Break line of sight or finish the run.' : '';
  }

  private setMessage(message: string): void {
    this.message = message;
    this.messageTimer = MESSAGE_DURATION;
  }
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('App container not found.');
}

new DungeonCrawlerApp(app);
