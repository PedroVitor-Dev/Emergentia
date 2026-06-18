import * as THREE from 'three';
import type { Agent, Base, LandPatch, SimulationSnapshot, VisualEffect, World } from '../core/types';

const worldScale = 0.5;
const maxVisibleCreatures = 160;
const maxVisibleFood = 640;
const maxVisibleBases = 12;
const maxVisibleLandPatches = 32;
const cameraMoveSpeed = 240;
const cameraMinHeight = 32;
const cameraMaxHeight = 380;
const cameraViewDistance = 940;
const mapMinZoom = 0.34;
const mapMaxZoom = 4.2;
const mapViewDistance = 1800;

export type CameraMode = 'spectator' | 'map';

type CreatureRig = {
  root: THREE.Group;
  body: THREE.Mesh;
  leftEye: THREE.Mesh;
  rightEye: THREE.Mesh;
  mouth: THREE.Mesh;
  teeth: THREE.InstancedMesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  hammerHandle: THREE.Mesh;
  hammerHead: THREE.Mesh;
  carryApple: THREE.Mesh;
  carryStem: THREE.Mesh;
  crown: THREE.Mesh;
  crownJewel: THREE.Mesh;
};

type EffectRig = {
  root: THREE.Group;
  ring: THREE.Mesh;
  core: THREE.Mesh;
};

type BaseRig = {
  root: THREE.Group;
  floor: THREE.Mesh;
  hut: THREE.Mesh;
  roof: THREE.Mesh;
  centralTower: THREE.Mesh;
  centralRoof: THREE.Mesh;
  leftTower: THREE.Mesh;
  rightTower: THREE.Mesh;
  wallSegments: THREE.InstancedMesh;
  battlements: THREE.InstancedMesh;
  gate: THREE.Mesh;
  flagPole: THREE.Mesh;
  flag: THREE.Mesh;
  torchFlames: THREE.InstancedMesh;
  beacon: THREE.Mesh;
};

export class ThreeWorldRenderer {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 2, 2800);
  private readonly mapCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 3600);
  private readonly spectatorPosition = new THREE.Vector3(0, 95, 440);
  private readonly mapTarget = new THREE.Vector3(0, 0, 0);
  private readonly appleBodyMesh: THREE.InstancedMesh;
  private readonly appleStemMesh: THREE.InstancedMesh;
  private readonly appleLeafMesh: THREE.InstancedMesh;
  private readonly creaturePool: CreatureRig[] = [];
  private readonly effectPool: EffectRig[] = [];
  private readonly basePool: BaseRig[] = [];
  private readonly landPatchPool: THREE.Mesh[] = [];
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly reusableMatrix = new THREE.Matrix4();
  private readonly reusableColor = new THREE.Color();
  private readonly resizeObserver: ResizeObserver;
  private readonly pressedKeys = new Set<string>();
  private readonly pointer = {
    active: false,
    lastX: 0,
    lastY: 0,
  };
  private yaw = 0;
  private pitch = -0.36;
  private cameraMode: CameraMode = 'spectator';
  private mapZoom = 1.05;
  private width = 1;
  private height = 1;
  private lastNavigationTime = performance.now();

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.renderer.domElement.className = 'webgl-canvas';
    this.container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#7fcfe4');
    this.scene.fog = new THREE.Fog('#7fcfe4', 520, 1750);

    this.appleBodyMesh = this.createAppleBodyMesh();
    this.appleStemMesh = this.createAppleStemMesh();
    this.appleLeafMesh = this.createAppleLeafMesh();
    this.scene.add(this.appleBodyMesh, this.appleStemMesh, this.appleLeafMesh);

    this.createWorldStage();
    this.createLights();
    this.createCreaturePool();
    this.createEffectPool();
    this.createBasePool();
    this.createLandPatchPool();
    this.attachNavigation();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  render(snapshot: SimulationSnapshot) {
    this.updateKeyboardNavigation(snapshot.world);

    if (this.cameraMode === 'spectator') {
      this.clampSpectatorToWorld(snapshot.world);
    } else {
      this.clampMapToWorld(snapshot.world);
    }

    const activeCamera = this.updateCamera();
    this.updateFood(snapshot);
    this.updateLandPatches(snapshot);
    this.updateBases(snapshot);
    this.updateCreatures(snapshot);
    this.updateEffects(snapshot);
    this.animateWorld(snapshot.world.tick);
    this.renderer.render(this.scene, activeCamera);
  }

  setCameraMode(mode: CameraMode) {
    this.cameraMode = mode;
    this.pointer.active = false;
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.container.removeEventListener('pointerdown', this.handlePointerDown);
    this.container.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    this.container.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize() {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(this.width, this.height, false);
    this.updateCamera();
  }

  private updateCamera() {
    if (this.cameraMode === 'map') {
      const aspect = this.width / this.height;
      const halfHeight = 1040 / this.mapZoom / 2;
      const halfWidth = halfHeight * aspect;

      this.mapCamera.left = -halfWidth;
      this.mapCamera.right = halfWidth;
      this.mapCamera.top = halfHeight;
      this.mapCamera.bottom = -halfHeight;
      this.mapCamera.position.set(this.mapTarget.x, 920 / this.mapZoom, this.mapTarget.z + 80);
      this.mapCamera.lookAt(this.mapTarget);
      this.mapCamera.updateProjectionMatrix();
      return this.mapCamera;
    }

    this.camera.aspect = this.width / this.height;
    this.camera.position.copy(this.spectatorPosition);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
    this.camera.updateProjectionMatrix();
    return this.camera;
  }

  private attachNavigation() {
    this.container.addEventListener('pointerdown', this.handlePointerDown);
    this.container.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    this.container.addEventListener('wheel', this.handleWheel, { passive: false });
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  private handlePointerDown = (event: PointerEvent) => {
    this.pointer.active = true;
    this.pointer.lastX = event.clientX;
    this.pointer.lastY = event.clientY;
    this.container.setPointerCapture(event.pointerId);
  };

  private handlePointerMove = (event: PointerEvent) => {
    if (!this.pointer.active) {
      return;
    }

    const dx = event.clientX - this.pointer.lastX;
    const dy = event.clientY - this.pointer.lastY;

    if (this.cameraMode === 'map') {
      const panSpeed = 1.6 / this.mapZoom;
      this.mapTarget.x -= dx * panSpeed;
      this.mapTarget.z -= dy * panSpeed;
    } else {
      const lookSensitivity = 0.0032;
      this.yaw -= dx * lookSensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - dy * lookSensitivity, -1.12, -0.08);
    }

    this.pointer.lastX = event.clientX;
    this.pointer.lastY = event.clientY;
  };

  private handlePointerUp = () => {
    this.pointer.active = false;
  };

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? 1 : -1;

    if (this.cameraMode === 'map') {
      this.mapZoom = THREE.MathUtils.clamp(this.mapZoom + -direction * 0.16 * this.mapZoom, mapMinZoom, mapMaxZoom);
      return;
    }

    this.spectatorPosition.y = THREE.MathUtils.clamp(this.spectatorPosition.y + direction * 12, cameraMinHeight, cameraMaxHeight);
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (this.isTypingTarget(event.target)) {
      return;
    }

    const key = event.key.toLowerCase();

    if (['w', 'a', 's', 'd'].includes(key)) {
      event.preventDefault();
      this.pressedKeys.add(key);
    }
  };

  private handleKeyUp = (event: KeyboardEvent) => {
    this.pressedKeys.delete(event.key.toLowerCase());
  };

  private updateKeyboardNavigation(world: World) {
    const now = performance.now();
    const deltaSeconds = Math.min(0.08, (now - this.lastNavigationTime) / 1000);
    this.lastNavigationTime = now;

    if (this.pressedKeys.size === 0) {
      return;
    }

    if (this.cameraMode === 'map') {
      const direction = new THREE.Vector2(0, 0);

      if (this.pressedKeys.has('w')) direction.y -= 1;
      if (this.pressedKeys.has('s')) direction.y += 1;
      if (this.pressedKeys.has('a')) direction.x -= 1;
      if (this.pressedKeys.has('d')) direction.x += 1;

      if (direction.lengthSq() === 0) {
        return;
      }

      direction.normalize();
      const movement = (780 * deltaSeconds) / this.mapZoom;
      this.mapTarget.x += direction.x * movement;
      this.mapTarget.z += direction.y * movement;
      this.clampMapToWorld(world);
      return;
    }

    const direction = new THREE.Vector3(0, 0, 0);
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    if (this.pressedKeys.has('w')) direction.add(forward);
    if (this.pressedKeys.has('s')) direction.sub(forward);
    if (this.pressedKeys.has('a')) direction.sub(right);
    if (this.pressedKeys.has('d')) direction.add(right);

    if (direction.lengthSq() === 0) {
      return;
    }

    direction.normalize();
    const heightScale = THREE.MathUtils.clamp(this.spectatorPosition.y / 110, 0.72, 1.9);
    const movement = cameraMoveSpeed * heightScale * deltaSeconds;
    this.spectatorPosition.addScaledVector(direction, movement);
    this.clampSpectatorToWorld(world);
  }

  private clampSpectatorToWorld(world: World) {
    const worldHalfWidth = (world.width * worldScale) / 2;
    const worldHalfHeight = (world.height * worldScale) / 2;
    const horizontalLimit = worldHalfWidth * 0.96;
    const verticalLimit = worldHalfHeight * 0.96;

    this.spectatorPosition.x = THREE.MathUtils.clamp(this.spectatorPosition.x, -horizontalLimit, horizontalLimit);
    this.spectatorPosition.z = THREE.MathUtils.clamp(this.spectatorPosition.z, -verticalLimit, verticalLimit);
    this.spectatorPosition.y = THREE.MathUtils.clamp(this.spectatorPosition.y, cameraMinHeight, cameraMaxHeight);
  }

  private clampMapToWorld(world: World) {
    const worldHalfWidth = (world.width * worldScale) / 2;
    const worldHalfHeight = (world.height * worldScale) / 2;
    const aspect = this.width / this.height;
    const halfViewHeight = 1040 / this.mapZoom / 2;
    const halfViewWidth = halfViewHeight * aspect;
    const horizontalLimit = Math.max(0, worldHalfWidth - halfViewWidth * 0.2);
    const verticalLimit = Math.max(0, worldHalfHeight - halfViewHeight * 0.2);

    this.mapTarget.x = THREE.MathUtils.clamp(this.mapTarget.x, -horizontalLimit, horizontalLimit);
    this.mapTarget.z = THREE.MathUtils.clamp(this.mapTarget.z, -verticalLimit, verticalLimit);
  }

  private isTypingTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  }

  private createWorldStage() {
    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(3100, 3100, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#0b2e35' }),
    );
    ocean.name = 'ocean-plane';
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -0.16;
    this.scene.add(ocean);

    const beach = new THREE.Mesh(
      new THREE.CircleGeometry(1120, 96),
      new THREE.MeshStandardMaterial({ color: '#7d6c43', roughness: 0.98, metalness: 0 }),
    );
    beach.name = 'island-beach';
    beach.rotation.x = -Math.PI / 2;
    beach.scale.set(1.08, 0.9, 1);
    beach.position.y = -0.06;
    this.scene.add(beach);

    const terrainMaterial = new THREE.MeshStandardMaterial({
      color: '#183b24',
      roughness: 0.95,
      metalness: 0.02,
    });
    const terrain = new THREE.Mesh(new THREE.CircleGeometry(970, 128), terrainMaterial);
    terrain.name = 'living-terrain';
    terrain.rotation.x = -Math.PI / 2;
    terrain.scale.set(1.05, 0.86, 1);
    this.scene.add(terrain);

    const grid = new THREE.GridHelper(1900, 44, '#315039', '#1f3226');
    grid.position.y = 0.18;
    grid.visible = false;
    this.scene.add(grid);

    for (let index = 0; index < 9; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: index % 2 === 0 ? '#2d5c33' : '#334927',
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      });
      const patch = new THREE.Mesh(new THREE.CircleGeometry(38 + (index % 4) * 18, 24), material);
      patch.name = 'biome-patch';
      patch.rotation.x = -Math.PI / 2;
      patch.scale.set(1.8 + (index % 3) * 0.45, 0.65 + (index % 2) * 0.35, 1);
      patch.position.set(((index * 227) % 1580) - 790, 0.25, ((index * 353) % 1480) - 740);
      this.scene.add(patch);
    }

    for (let index = 0; index < 28; index += 1) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 20, 5), this.getMaterial('#3a2417'));
      const crown = new THREE.Mesh(new THREE.ConeGeometry(12 + (index % 3) * 3, 28, 7), this.getMaterial('#265c32'));
      const palm = new THREE.Group();
      const angle = index * 2.399;
      const radius = 430 + (index % 9) * 62;
      palm.name = 'palm';
      palm.position.set(Math.cos(angle) * radius, 10, Math.sin(angle) * radius * 0.78);
      palm.rotation.y = angle;
      trunk.position.y = 8;
      trunk.rotation.z = Math.sin(index) * 0.16;
      crown.position.y = 24;
      crown.rotation.z = Math.cos(index) * 0.18;
      palm.add(trunk, crown);
      this.scene.add(palm);
    }

    for (let index = 0; index < 22; index += 1) {
      const angle = index * 1.718;
      const radius = 190 + (index % 8) * 84;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(8 + (index % 4) * 3, 0),
        this.getMaterial(index % 2 === 0 ? '#706b5b' : '#544f46'),
      );
      rock.name = 'volcanic-rock';
      rock.position.set(Math.cos(angle) * radius, 5, Math.sin(angle) * radius * 0.8);
      rock.rotation.set(index * 0.31, index * 0.77, index * 0.19);
      rock.scale.set(1.2, 0.5 + (index % 3) * 0.25, 0.9);
      this.scene.add(rock);
    }

    for (let index = 0; index < 10; index += 1) {
      const mound = new THREE.Mesh(
        new THREE.ConeGeometry(42 + (index % 4) * 18, 16 + (index % 3) * 8, 18),
        this.getMaterial(index % 2 === 0 ? '#24472b' : '#2e542d'),
      );
      const angle = index * 2.071;
      const radius = 150 + (index % 6) * 98;
      mound.name = 'jungle-mound';
      mound.position.set(Math.cos(angle) * radius, 6, Math.sin(angle) * radius * 0.75);
      mound.rotation.y = angle;
      mound.scale.z = 0.55 + (index % 2) * 0.3;
      this.scene.add(mound);
    }

    for (let index = 0; index < 5; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: '#376a67',
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      });
      const vein = new THREE.Mesh(new THREE.PlaneGeometry(1320, 11, 1, 1), material);
      vein.name = 'water-vein';
      vein.rotation.x = -Math.PI / 2;
      vein.rotation.z = -0.28 + index * 0.15;
      vein.position.set(-220 + index * 120, 0.35, -610 + index * 300);
      this.scene.add(vein);
    }
  }

  private createLights() {
    this.scene.add(new THREE.HemisphereLight('#e8ffee', '#170606', 2.4));

    const redLight = new THREE.PointLight('#ff475f', 3.2, 900, 1.7);
    redLight.position.set(-320, 360, -220);
    this.scene.add(redLight);

    const greenLight = new THREE.PointLight('#86efac', 2.3, 780, 1.5);
    greenLight.position.set(360, 260, 260);
    this.scene.add(greenLight);
  }

  private createAppleBodyMesh() {
    const geometry = new THREE.SphereGeometry(3.8, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: '#d82635',
    });
    const mesh = new THREE.InstancedMesh(geometry, material, maxVisibleFood);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }

  private createAppleStemMesh() {
    const geometry = new THREE.CylinderGeometry(0.45, 0.58, 3.2, 5);
    const material = new THREE.MeshBasicMaterial({ color: '#3a2417' });
    const mesh = new THREE.InstancedMesh(geometry, material, maxVisibleFood);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }

  private createAppleLeafMesh() {
    const geometry = new THREE.SphereGeometry(1.4, 6, 6);
    const material = new THREE.MeshBasicMaterial({ color: '#55b85f' });
    const mesh = new THREE.InstancedMesh(geometry, material, maxVisibleFood);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }

  private createCreaturePool() {
    for (let index = 0; index < maxVisibleCreatures; index += 1) {
      const rig = this.createCreatureRig();
      rig.root.visible = false;
      this.creaturePool.push(rig);
      this.scene.add(rig.root);
    }
  }

  private createEffectPool() {
    for (let index = 0; index < 96; index += 1) {
      const root = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(6, 7.8, 24),
        new THREE.MeshBasicMaterial({
          color: '#86efac',
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(3.4, 10, 10),
        new THREE.MeshBasicMaterial({
          color: '#86efac',
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      root.visible = false;
      root.add(ring, core);
      this.effectPool.push({ root, ring, core });
      this.scene.add(root);
    }
  }

  private createBasePool() {
    for (let index = 0; index < maxVisibleBases; index += 1) {
      const root = new THREE.Group();
      const floor = new THREE.Mesh(new THREE.CylinderGeometry(44, 54, 6, 16), this.getMaterial('#6d665b'));
      const hut = new THREE.Mesh(new THREE.BoxGeometry(52, 34, 42), this.getMaterial('#7b7469'));
      const roof = new THREE.Mesh(new THREE.ConeGeometry(38, 24, 4), this.getMaterial('#2a1a12'));
      const centralTower = new THREE.Mesh(new THREE.CylinderGeometry(13, 17, 74, 10), this.getMaterial('#8a8174'));
      const centralRoof = new THREE.Mesh(new THREE.ConeGeometry(20, 24, 6), this.getMaterial('#2a1a12'));
      const leftTower = new THREE.Mesh(new THREE.CylinderGeometry(10, 13, 54, 8), this.getMaterial('#8a8174'));
      const rightTower = leftTower.clone();
      const wallSegments = new THREE.InstancedMesh(new THREE.BoxGeometry(18, 13, 8), this.getMaterial('#766d61'), 18);
      const battlements = new THREE.InstancedMesh(new THREE.BoxGeometry(5.5, 5, 5), this.getMaterial('#7b654b'), 8);
      const gate = new THREE.Mesh(new THREE.BoxGeometry(11, 15, 3), this.getMaterial('#21140d'));
      const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 42, 6), this.getMaterial('#2c1b12'));
      const flag = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 12, 1, 1),
        new THREE.MeshBasicMaterial({ color: '#f8d56b', side: THREE.DoubleSide }),
      );
      const torchFlames = new THREE.InstancedMesh(
        new THREE.SphereGeometry(2.8, 8, 8),
        new THREE.MeshBasicMaterial({ color: '#ff9a3d', transparent: true, opacity: 0.86 }),
        6,
      );
      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(4.2, 8, 8),
        new THREE.MeshBasicMaterial({ color: '#f8d56b', transparent: true, opacity: 0.72 }),
      );

      floor.position.y = 3;
      hut.position.y = 23;
      roof.position.y = 53;
      roof.rotation.y = Math.PI * 0.25;
      centralTower.position.set(0, 41, 10);
      centralRoof.position.set(0, 90, 10);
      leftTower.position.set(-33, 30, -2);
      rightTower.position.set(33, 30, -2);
      gate.position.set(0, 14, -22.8);
      flagPole.position.set(0, 102, 10);
      flag.position.set(10.4, 111, 10);
      flag.rotation.y = Math.PI * 0.5;
      beacon.position.y = 72;
      for (let segment = 0; segment < 18; segment += 1) {
        const angle = (segment / 18) * Math.PI * 2;
        const radius = 70;
        this.reusableMatrix.compose(
          new THREE.Vector3(Math.cos(angle) * radius, 8.5, Math.sin(angle) * radius),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -angle, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        wallSegments.setMatrixAt(segment, this.reusableMatrix);
      }
      for (let block = 0; block < 8; block += 1) {
        const x = -34 + block * 9.7;
        this.reusableMatrix.compose(new THREE.Vector3(x, 42, -22), new THREE.Quaternion(), new THREE.Vector3(1.15, 1.15, 1.15));
        battlements.setMatrixAt(block, this.reusableMatrix);
      }
      for (let torch = 0; torch < 6; torch += 1) {
        const angle = (torch / 6) * Math.PI * 2 + 0.35;
        this.reusableMatrix.compose(
          new THREE.Vector3(Math.cos(angle) * 52, 20, Math.sin(angle) * 52),
          new THREE.Quaternion(),
          new THREE.Vector3(1, 1.25, 1),
        );
        torchFlames.setMatrixAt(torch, this.reusableMatrix);
      }
      wallSegments.instanceMatrix.needsUpdate = true;
      battlements.instanceMatrix.needsUpdate = true;
      torchFlames.instanceMatrix.needsUpdate = true;
      root.visible = false;
      root.add(
        floor,
        hut,
        roof,
        centralTower,
        centralRoof,
        leftTower,
        rightTower,
        wallSegments,
        battlements,
        gate,
        flagPole,
        flag,
        torchFlames,
        beacon,
      );
      this.basePool.push({
        root,
        floor,
        hut,
        roof,
        centralTower,
        centralRoof,
        leftTower,
        rightTower,
        wallSegments,
        battlements,
        gate,
        flagPole,
        flag,
        torchFlames,
        beacon,
      });
      this.scene.add(root);
    }
  }

  private createLandPatchPool() {
    for (let index = 0; index < maxVisibleLandPatches; index += 1) {
      const patch = new THREE.Mesh(
        new THREE.CircleGeometry(1, 32),
        new THREE.MeshStandardMaterial({
          color: '#3f7241',
          roughness: 0.95,
          metalness: 0.01,
          transparent: true,
          opacity: 0.9,
        }),
      );
      patch.rotation.x = -Math.PI / 2;
      patch.visible = false;
      this.landPatchPool.push(patch);
      this.scene.add(patch);
    }
  }

  private createCreatureRig(): CreatureRig {
    const root = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: '#b70913',
      roughness: 0.82,
      metalness: 0.04,
    });
    const limbMaterial = new THREE.MeshStandardMaterial({
      color: '#6b0508',
      roughness: 0.86,
      metalness: 0.03,
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(20, 27, 13), bodyMaterial);
    const leftEye = new THREE.Mesh(new THREE.SphereGeometry(3.3, 10, 10), this.getMaterial('#020202'));
    const rightEye = new THREE.Mesh(new THREE.SphereGeometry(3.3, 10, 10), this.getMaterial('#020202'));
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(12, 2.6, 2), this.getMaterial('#050202'));
    const teeth = new THREE.InstancedMesh(new THREE.ConeGeometry(1.25, 3.4, 4), this.getMaterial('#f2eee4'), 6);
    const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(4, 10, 4), limbMaterial.clone());
    const rightLeg = leftLeg.clone();
    const leftArm = new THREE.Mesh(new THREE.BoxGeometry(3.4, 13, 3.4), limbMaterial.clone());
    const rightArm = leftArm.clone();
    const hammerHandle = new THREE.Mesh(new THREE.BoxGeometry(1.1, 13, 1.1), this.getMaterial('#4a2d1b'));
    const hammerHead = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.8), this.getMaterial('#4c4c46'));
    const carryApple = new THREE.Mesh(new THREE.SphereGeometry(3.2, 8, 8), this.getMaterial('#d82635'));
    const carryStem = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.48, 2.6, 5), this.getMaterial('#3a2417'));
    const crown = new THREE.Mesh(new THREE.ConeGeometry(6.2, 5.5, 5), this.getMaterial('#f8d56b'));
    const crownJewel = new THREE.Mesh(new THREE.SphereGeometry(1.4, 6, 6), this.getMaterial('#f472b6'));

    hammerHandle.visible = false;
    hammerHead.visible = false;
    carryApple.visible = false;
    carryStem.visible = false;
    crown.visible = false;
    crownJewel.visible = false;
    root.add(body, leftEye, rightEye, mouth, teeth, leftLeg, rightLeg, leftArm, rightArm, hammerHandle, hammerHead, carryApple, carryStem, crown, crownJewel);
    return {
      root,
      body,
      leftEye,
      rightEye,
      mouth,
      teeth,
      leftLeg,
      rightLeg,
      leftArm,
      rightArm,
      hammerHandle,
      hammerHead,
      carryApple,
      carryStem,
      crown,
      crownJewel,
    };
  }

  private updateFood(snapshot: SimulationSnapshot) {
    const visibleFood = snapshot.food.filter((item) => this.isVisible(item.position.x, item.position.y, snapshot.world, 80)).slice(0, maxVisibleFood);

    visibleFood.forEach((food, index) => {
      const position = this.toScenePosition(food.position.x, food.position.y, snapshot.world);
      const pulse = 1 + Math.sin(snapshot.world.tick * 0.05 + food.id) * 0.12;
      this.reusableMatrix.compose(
        new THREE.Vector3(position.x, 4.2 + pulse, position.z),
        new THREE.Quaternion(),
        new THREE.Vector3(pulse, pulse * 0.92, pulse),
      );
      this.appleBodyMesh.setMatrixAt(index, this.reusableMatrix);

      this.reusableMatrix.compose(
        new THREE.Vector3(position.x, 8.2 + pulse, position.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.16, 0, 0.28)),
        new THREE.Vector3(1, 1, 1),
      );
      this.appleStemMesh.setMatrixAt(index, this.reusableMatrix);

      this.reusableMatrix.compose(
        new THREE.Vector3(position.x + 1.4, 9 + pulse, position.z - 0.4),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.42, 0.2, -0.65)),
        new THREE.Vector3(1.45, 0.42, 0.82),
      );
      this.appleLeafMesh.setMatrixAt(index, this.reusableMatrix);
    });

    this.appleBodyMesh.count = visibleFood.length;
    this.appleStemMesh.count = visibleFood.length;
    this.appleLeafMesh.count = visibleFood.length;
    this.appleBodyMesh.instanceMatrix.needsUpdate = true;
    this.appleStemMesh.instanceMatrix.needsUpdate = true;
    this.appleLeafMesh.instanceMatrix.needsUpdate = true;
  }

  private updateLandPatches(snapshot: SimulationSnapshot) {
    const visiblePatches = snapshot.landPatches
      .filter((patch) => this.isVisible(patch.position.x, patch.position.y, snapshot.world, patch.radius))
      .slice(0, maxVisibleLandPatches);

    this.landPatchPool.forEach((mesh, index) => {
      const patch = visiblePatches[index];

      if (!patch) {
        mesh.visible = false;
        return;
      }

      const position = this.toScenePosition(patch.position.x, patch.position.y, snapshot.world);
      const age = Math.min(1, (snapshot.world.tick - patch.createdTick) / 90);
      const material = mesh.material as THREE.MeshStandardMaterial;
      const color = snapshot.species.find((species) => species.id === patch.speciesId)?.color ?? '#3f7241';

      mesh.visible = true;
      mesh.position.set(position.x, 0.08, position.z);
      mesh.scale.setScalar((patch.radius * worldScale * 0.95) * (0.25 + age * 0.75));
      mesh.rotation.z = patch.id * 0.41;
      material.color.set(color).lerp(new THREE.Color('#345c32'), 0.72);
      material.opacity = 0.42 + age * 0.5;
    });
  }

  private updateBases(snapshot: SimulationSnapshot) {
    const visibleBases = snapshot.bases
      .filter((base) => this.isVisible(base.position.x, base.position.y, snapshot.world, base.radius))
      .slice(0, maxVisibleBases);

    this.basePool.forEach((rig, index) => {
      const base = visibleBases[index];

      if (!base) {
        rig.root.visible = false;
        return;
      }

      this.updateBaseRig(rig, base, snapshot);
    });
  }

  private updateBaseRig(rig: BaseRig, base: Base, snapshot: SimulationSnapshot) {
    const position = this.toScenePosition(base.position.x, base.position.y, snapshot.world);
    const speciesColor = snapshot.species.find((species) => species.id === base.speciesId)?.color ?? '#f8d56b';
    const pulse = 1 + Math.sin(snapshot.world.tick * 0.06 + base.id) * 0.04;
    const foodLevel = Math.min(1, base.foodStock / 180);
    const populationLevel = Math.min(1, base.population / 48);
    const castleLevel = Math.max(foodLevel, populationLevel, Math.min(1, base.expansionLevel / 8));
    const progressScale = 0.82 + Math.min(0.3, base.buildProgress / 260) + castleLevel * 0.28;

    rig.root.visible = true;
    rig.root.position.set(position.x, 1.4, position.z);
    rig.root.rotation.y = base.id * 0.57;
    rig.root.scale.setScalar(progressScale * pulse * 1.34);
    (rig.floor.material as THREE.MeshStandardMaterial).color.set(speciesColor).lerp(new THREE.Color('#6d665b'), 0.5);
    (rig.hut.material as THREE.MeshStandardMaterial).color.set(speciesColor).lerp(new THREE.Color('#7b7469'), 0.55);
    (rig.centralTower.material as THREE.MeshStandardMaterial).color.set(speciesColor).lerp(new THREE.Color('#8a8174'), 0.54);
    (rig.leftTower.material as THREE.MeshStandardMaterial).color.set(speciesColor).lerp(new THREE.Color('#8a8174'), 0.62);
    (rig.rightTower.material as THREE.MeshStandardMaterial).color.set(speciesColor).lerp(new THREE.Color('#8a8174'), 0.62);
    (rig.flag.material as THREE.MeshBasicMaterial).color.set(speciesColor);
    (rig.wallSegments.material as THREE.MeshStandardMaterial).color.set(speciesColor).lerp(new THREE.Color('#766d61'), 0.68);
    (rig.gate.material as THREE.MeshStandardMaterial).color.set(base.threatLevel > 0 ? '#120909' : '#21140d');
    (rig.beacon.material as THREE.MeshBasicMaterial).color.set(speciesColor);
    (rig.beacon.material as THREE.MeshBasicMaterial).opacity = 0.48 + Math.min(0.4, base.population * 0.018 + foodLevel * 0.18);
    (rig.torchFlames.material as THREE.MeshBasicMaterial).opacity = 0.58 + Math.sin(snapshot.world.tick * 0.12 + base.id) * 0.18 + castleLevel * 0.12;
    rig.centralTower.scale.y = 0.82 + castleLevel * 0.4;
    rig.centralRoof.position.y = 84 + castleLevel * 18;
    rig.flagPole.position.y = 98 + castleLevel * 20;
    rig.flag.position.y = 107 + castleLevel * 20;
    rig.flag.scale.set(0.92 + populationLevel * 0.42, 0.86 + foodLevel * 0.32, 1);
    rig.beacon.position.y = 70 + castleLevel * 24;
  }

  private updateCreatures(snapshot: SimulationSnapshot) {
    const eatingAgents = this.getEatingAgentIds(snapshot);
    const buildingAgents = this.getBuildingAgentIds(snapshot);
    const fightingAgents = this.getFightingAgentIds(snapshot);
    const colors = new Map(snapshot.species.map((species) => [species.id, species.color]));
    const visibleAgents = snapshot.agents
      .filter((agent) => this.isVisible(agent.position.x, agent.position.y, snapshot.world, 130))
      .slice(0, maxVisibleCreatures);

    this.creaturePool.forEach((rig, index) => {
      const agent = visibleAgents[index];

      if (!agent) {
        rig.root.visible = false;
        return;
      }

      this.updateCreatureRig(
        rig,
        agent,
        colors.get(agent.speciesId) ?? '#b70913',
        snapshot.world,
        snapshot.world.tick,
        eatingAgents.has(agent.id),
        buildingAgents.has(agent.id),
        fightingAgents.has(agent.id),
      );
    });
  }

  private updateCreatureRig(
    rig: CreatureRig,
    agent: Agent,
    color: string,
    world: World,
    tick: number,
    isEating: boolean,
    isBuilding: boolean,
    isFighting: boolean,
  ) {
    const position = this.toScenePosition(agent.position.x, agent.position.y, world);
    const direction = agent.facingAngle;
    const gait = Math.sin(tick * 0.12 + agent.id) * 0.6;
    const chew = isEating ? Math.sin(tick * 0.85 + agent.id) * 0.8 : 0;
    const hammerSwing = isBuilding ? Math.sin(tick * 0.42 + agent.id) : 0;
    const punch = isFighting ? Math.max(0, Math.sin(tick * 0.72 + agent.id)) : 0;
    const bodyScale = 0.82 + Math.min(0.32, agent.energy / 360);
    const widthScale = 0.82 + agent.dna.social * 0.45;
    const heightScale = 0.84 + agent.dna.fertility * 0.5;
    const leaderScale = agent.isLeader ? 1.86 : 1;

    rig.root.visible = true;
    rig.root.position.set(position.x, 15 + (isEating ? Math.abs(chew) * 0.55 : 0) + punch * 1.4, position.z - punch * 3.2);
    rig.root.rotation.y = direction;
    rig.root.scale.set(widthScale * leaderScale, bodyScale * heightScale * leaderScale, leaderScale);

    this.reusableColor.set(color);
    const bodyMaterial = rig.body.material as THREE.MeshStandardMaterial;
    bodyMaterial.color.copy(this.reusableColor);
    bodyMaterial.emissive.copy(this.reusableColor).multiplyScalar(0.22);

    const limbColor = this.reusableColor.clone().multiplyScalar(0.56);
    [rig.leftLeg, rig.rightLeg, rig.leftArm, rig.rightArm].forEach((mesh) => {
      const material = mesh.material as THREE.MeshStandardMaterial;
      material.color.copy(limbColor);
      material.emissive.copy(limbColor).multiplyScalar(0.12);
    });

    rig.body.position.set(0, 12 - (isEating ? Math.abs(chew) * 0.55 : 0), 0);
    rig.body.scale.set(1, 1, 1);

    const eyeSize = 0.78 + agent.dna.vision * 0.38;
    rig.leftEye.position.set(-5, 17, -7.2);
    rig.rightEye.position.set(5, 17, -7.2);
    rig.leftEye.scale.set(eyeSize, eyeSize, eyeSize);
    rig.rightEye.scale.set(eyeSize, eyeSize, eyeSize);

    rig.mouth.position.set(0, 9.5 - Math.abs(chew) * 0.7, -7.4);
    rig.mouth.scale.set(1 + agent.dna.aggression * 0.45, isEating ? 1.45 : 1, 1);

    rig.leftLeg.position.set(-5.2, -4.5 + gait, 0);
    rig.rightLeg.position.set(5.2, -4.5 - gait, 0);
    rig.leftArm.position.set(-12.5, 8 + gait * 2, isEating ? -2.2 : 0);
    rig.rightArm.position.set(12.5, 8 - gait * 2, isEating || isBuilding ? -2.2 : -punch * 7);
    rig.leftArm.rotation.z = (isEating ? 0.75 : 0.35) + gait * 0.35;
    rig.rightArm.rotation.z = (isBuilding ? -1.25 - hammerSwing * 0.55 : isEating ? -0.75 : -0.35 - punch * 1.15) - gait * 0.35;
    rig.rightArm.rotation.x = -punch * 0.72;
    rig.hammerHandle.visible = isBuilding;
    rig.hammerHead.visible = isBuilding;
    rig.hammerHandle.position.set(15.2, 7.2, -5);
    rig.hammerHandle.rotation.z = -0.68 - hammerSwing * 0.62;
    rig.hammerHandle.rotation.x = 0.22;
    rig.hammerHead.position.set(17.8 + hammerSwing * 2.4, 1.5 - Math.abs(hammerSwing) * 2.8, -5.2);
    rig.hammerHead.rotation.z = rig.hammerHandle.rotation.z + Math.PI * 0.5;
    rig.carryApple.visible = agent.carryingFood > 0 && !isBuilding;
    rig.carryStem.visible = agent.carryingFood > 0 && !isBuilding;
    rig.carryApple.position.set(-14, 5.5 + gait * 1.4, -6.4);
    rig.carryApple.scale.setScalar(0.78 + Math.min(0.45, agent.carryingFood / 60));
    rig.carryStem.position.set(-13.2, 9 + gait * 1.4, -6.4);
    rig.carryStem.rotation.z = 0.32;
    rig.crown.visible = agent.isLeader;
    rig.crownJewel.visible = agent.isLeader;
    rig.crown.position.set(0, 29.5, -0.4);
    rig.crown.rotation.y = tick * 0.012 + agent.id;
    rig.crownJewel.position.set(0, 33.2, -2.4);

    const teethCount = 3 + Math.round(agent.dna.aggression * 3);
    for (let index = 0; index < 6; index += 1) {
      const x = -5 + index * 2;
      this.reusableMatrix.compose(
        new THREE.Vector3(x, 7.6, -8.1),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0)),
        new THREE.Vector3(1, index < teethCount ? 1 : 0.001, 1),
      );
      rig.teeth.setMatrixAt(index, this.reusableMatrix);
    }
    rig.teeth.instanceMatrix.needsUpdate = true;
  }

  private updateEffects(snapshot: SimulationSnapshot) {
    this.effectPool.forEach((rig, index) => {
      const effect = snapshot.visualEffects[index];

      if (!effect || !this.isVisible(effect.position.x, effect.position.y, snapshot.world, 180)) {
        rig.root.visible = false;
        return;
      }

      this.updateEffectRig(rig, effect, snapshot);
    });
  }

  private updateEffectRig(rig: EffectRig, effect: VisualEffect, snapshot: SimulationSnapshot) {
    const age = snapshot.world.tick - effect.tick;
    const progress = Math.min(1, age / 96);
    const position = this.toScenePosition(effect.position.x, effect.position.y, snapshot.world);
    const color =
      effect.type === 'death'
        ? '#ff365b'
        : effect.type === 'combat'
          ? '#ff2f24'
          : effect.type === 'eat'
            ? '#86efac'
            : effect.type === 'build'
              ? '#f6b44b'
              : effect.type === 'deposit'
                ? '#e8f06a'
                : effect.type === 'peace'
                  ? '#8bd3ff'
                  : effect.type === 'rally'
                    ? '#f472b6'
                    : '#f8d56b';
    const ringMaterial = rig.ring.material as THREE.MeshBasicMaterial;
    const coreMaterial = rig.core.material as THREE.MeshBasicMaterial;
    const scale =
      effect.type === 'birth'
        ? 1 + progress * 3.8
        : effect.type === 'eat'
          ? 0.7 + progress * 1.4
          : effect.type === 'build'
            ? 0.8 + Math.sin(progress * Math.PI) * 1.8
            : effect.type === 'deposit'
              ? 0.6 + Math.sin(progress * Math.PI) * 2.2
              : effect.type === 'peace'
                ? 1 + Math.sin(progress * Math.PI) * 3.2
                : effect.type === 'rally'
                  ? 0.9 + progress * 3.6
          : effect.type === 'combat'
            ? 0.9 + Math.sin(progress * Math.PI) * 2.4
            : 1 + progress * 2.6;
    const opacity = Math.max(0, 1 - progress);

    rig.root.visible = true;
    rig.root.position.set(position.x, 4 + progress * 20, position.z);
    rig.root.scale.setScalar(scale);
    ringMaterial.color.set(color);
    coreMaterial.color.set(color);
    ringMaterial.opacity = opacity * (effect.type === 'death' || effect.type === 'combat' ? 0.78 : 0.58);
    coreMaterial.opacity = opacity * (effect.type === 'eat' || effect.type === 'combat' || effect.type === 'build' ? 0.82 : 0.38);
    rig.core.position.y =
      effect.type === 'death'
        ? progress * 18
        : effect.type === 'combat' || effect.type === 'build' || effect.type === 'rally'
          ? 8 + Math.sin(progress * Math.PI) * 12
          : effect.type === 'deposit' || effect.type === 'peace'
            ? 4 + Math.sin(progress * Math.PI) * 7
          : progress * 8;
  }

  private getEatingAgentIds(snapshot: SimulationSnapshot) {
    const recentEatEffects = snapshot.visualEffects.filter((effect) => effect.type === 'eat' && snapshot.world.tick - effect.tick < 16);
    const eatingAgents = new Set<number>();

    recentEatEffects.forEach((effect) => {
      const nearest = snapshot.agents.reduce<{ agent: Agent | null; distance: number }>(
        (closest, agent) => {
          const dx = agent.position.x - effect.position.x;
          const dy = agent.position.y - effect.position.y;
          const distance = dx * dx + dy * dy;
          return distance < closest.distance ? { agent, distance } : closest;
        },
        { agent: null, distance: 48 * 48 },
      );

      if (nearest.agent) {
        eatingAgents.add(nearest.agent.id);
      }
    });

    return eatingAgents;
  }

  private getBuildingAgentIds(snapshot: SimulationSnapshot) {
    const recentBuildEffects = snapshot.visualEffects.filter((effect) => effect.type === 'build' && snapshot.world.tick - effect.tick < 28);
    const buildingAgents = new Set<number>();

    recentBuildEffects.forEach((effect) => {
      snapshot.agents
        .filter((agent) => agent.speciesId === effect.speciesId)
        .map((agent) => ({
          agent,
          distance: (agent.position.x - effect.position.x) ** 2 + (agent.position.y - effect.position.y) ** 2,
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 5)
        .forEach(({ agent }) => buildingAgents.add(agent.id));
    });

    return buildingAgents;
  }

  private getFightingAgentIds(snapshot: SimulationSnapshot) {
    const recentCombatEffects = snapshot.visualEffects.filter((effect) => effect.type === 'combat' && snapshot.world.tick - effect.tick < 24);
    const fightingAgents = new Set<number>();

    recentCombatEffects.forEach((effect) => {
      snapshot.agents
        .filter((agent) => agent.speciesId === effect.speciesId || agent.intent === 'attack' || agent.intent === 'defend')
        .map((agent) => ({
          agent,
          distance: (agent.position.x - effect.position.x) ** 2 + (agent.position.y - effect.position.y) ** 2,
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 2)
        .forEach(({ agent }) => fightingAgents.add(agent.id));
    });

    return fightingAgents;
  }

  private animateWorld(tick: number) {
    this.scene.children.forEach((child) => {
      if (child.name === 'biome-patch') {
        child.position.y = 0.22 + Math.sin(tick * 0.01 + child.position.x * 0.01) * 0.04;
      }

      if (child.name === 'water-vein') {
        const material = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        material.opacity = 0.34 + Math.sin(tick * 0.018 + child.position.z * 0.01) * 0.08;
      }
    });
  }

  private isVisible(x: number, y: number, world: World, margin: number) {
    const position = this.toScenePosition(x, y, world);
    const origin = this.cameraMode === 'map' ? this.mapTarget : this.spectatorPosition;
    const distance = Math.hypot(position.x - origin.x, position.z - origin.z);
    const viewDistance = this.cameraMode === 'map' ? mapViewDistance / this.mapZoom : cameraViewDistance;

    return distance <= viewDistance + margin;
  }

  private toScenePosition(x: number, y: number, world: World) {
    return {
      x: (x - world.width / 2) * worldScale,
      z: (y - world.height / 2) * worldScale,
    };
  }

  private getMaterial(color: string) {
    const existing = this.materials.get(color);

    if (existing) {
      return existing;
    }

    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.82,
      metalness: 0.04,
      emissive: '#000000',
    });
    this.materials.set(color, material);
    return material;
  }
}
