import * as THREE from 'three';
import type { Agent, SimulationSnapshot, VisualEffect, World } from '../core/types';

const worldScale = 0.5;
const maxVisibleCreatures = 160;
const maxVisibleFood = 640;
const cameraMoveSpeed = 170;
const cameraMinHeight = 32;
const cameraMaxHeight = 260;
const cameraCreatureRadius = 38;
const cameraViewDistance = 620;

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
};

type EffectRig = {
  root: THREE.Group;
  ring: THREE.Mesh;
  core: THREE.Mesh;
};

export class ThreeWorldRenderer {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 2, 2600);
  private readonly cameraPosition = new THREE.Vector3(0, 95, 440);
  private readonly foodMesh: THREE.InstancedMesh;
  private readonly creaturePool: CreatureRig[] = [];
  private readonly effectPool: EffectRig[] = [];
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

    this.foodMesh = this.createFoodMesh();
    this.scene.add(this.foodMesh);

    this.createWorldStage();
    this.createLights();
    this.createCreaturePool();
    this.createEffectPool();
    this.attachNavigation();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  render(snapshot: SimulationSnapshot) {
    this.updateKeyboardNavigation(snapshot.world);
    this.keepCameraAwayFromAgents(snapshot);
    this.clampCameraToWorld(snapshot.world);
    this.updateCamera();
    this.updateFood(snapshot);
    this.updateCreatures(snapshot);
    this.updateEffects(snapshot);
    this.animateWorld(snapshot.world.tick);
    this.renderer.render(this.scene, this.camera);
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
    this.camera.aspect = this.width / this.height;
    this.camera.position.copy(this.cameraPosition);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
    this.camera.updateProjectionMatrix();
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
    const lookSensitivity = 0.0032;

    this.yaw -= dx * lookSensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * lookSensitivity, -1.12, -0.08);
    this.pointer.lastX = event.clientX;
    this.pointer.lastY = event.clientY;
  };

  private handlePointerUp = () => {
    this.pointer.active = false;
  };

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? 1 : -1;
    this.cameraPosition.y = THREE.MathUtils.clamp(this.cameraPosition.y + direction * 12, cameraMinHeight, cameraMaxHeight);
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
    const heightScale = THREE.MathUtils.clamp(this.cameraPosition.y / 110, 0.72, 1.9);
    const movement = cameraMoveSpeed * heightScale * deltaSeconds;
    this.cameraPosition.addScaledVector(direction, movement);
    this.clampCameraToWorld(world);
  }

  private clampCameraToWorld(world: World) {
    const worldHalfWidth = (world.width * worldScale) / 2;
    const worldHalfHeight = (world.height * worldScale) / 2;
    const horizontalLimit = worldHalfWidth * 0.88;
    const verticalLimit = worldHalfHeight * 0.88;

    this.cameraPosition.x = THREE.MathUtils.clamp(this.cameraPosition.x, -horizontalLimit, horizontalLimit);
    this.cameraPosition.z = THREE.MathUtils.clamp(this.cameraPosition.z, -verticalLimit, verticalLimit);
    this.cameraPosition.y = THREE.MathUtils.clamp(this.cameraPosition.y, cameraMinHeight, cameraMaxHeight);
  }

  private keepCameraAwayFromAgents(snapshot: SimulationSnapshot) {
    const camera2D = new THREE.Vector2(this.cameraPosition.x, this.cameraPosition.z);

    snapshot.agents.forEach((agent) => {
      const position = this.toScenePosition(agent.position.x, agent.position.y, snapshot.world);
      const agent2D = new THREE.Vector2(position.x, position.z);
      const distance = camera2D.distanceTo(agent2D);

      if (distance <= 0 || distance >= cameraCreatureRadius) {
        return;
      }

      const push = camera2D.sub(agent2D).normalize().multiplyScalar(cameraCreatureRadius - distance);
      this.cameraPosition.x += push.x;
      this.cameraPosition.z += push.y;
      camera2D.set(this.cameraPosition.x, this.cameraPosition.z);
    });
  }

  private isTypingTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
  }

  private createWorldStage() {
    const ocean = new THREE.Mesh(
      new THREE.PlaneGeometry(1900, 1900, 1, 1),
      new THREE.MeshBasicMaterial({ color: '#0b2e35' }),
    );
    ocean.name = 'ocean-plane';
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.y = -0.16;
    this.scene.add(ocean);

    const beach = new THREE.Mesh(
      new THREE.CircleGeometry(660, 80),
      new THREE.MeshStandardMaterial({ color: '#7d6c43', roughness: 0.98, metalness: 0 }),
    );
    beach.name = 'island-beach';
    beach.rotation.x = -Math.PI / 2;
    beach.scale.set(1.05, 0.86, 1);
    beach.position.y = -0.06;
    this.scene.add(beach);

    const terrainMaterial = new THREE.MeshStandardMaterial({
      color: '#183b24',
      roughness: 0.95,
      metalness: 0.02,
    });
    const terrain = new THREE.Mesh(new THREE.CircleGeometry(560, 96), terrainMaterial);
    terrain.name = 'living-terrain';
    terrain.rotation.x = -Math.PI / 2;
    terrain.scale.set(1.03, 0.82, 1);
    this.scene.add(terrain);

    const grid = new THREE.GridHelper(1120, 32, '#315039', '#1f3226');
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
      patch.position.set(((index * 137) % 920) - 460, 0.25, ((index * 229) % 920) - 460);
      this.scene.add(patch);
    }

    for (let index = 0; index < 28; index += 1) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 20, 5), this.getMaterial('#3a2417'));
      const crown = new THREE.Mesh(new THREE.ConeGeometry(12 + (index % 3) * 3, 28, 7), this.getMaterial('#265c32'));
      const palm = new THREE.Group();
      const angle = index * 2.399;
      const radius = 250 + (index % 9) * 36;
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
      const radius = 120 + (index % 8) * 46;
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
      const radius = 90 + (index % 6) * 58;
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
      const vein = new THREE.Mesh(new THREE.PlaneGeometry(760, 9, 1, 1), material);
      vein.name = 'water-vein';
      vein.rotation.x = -Math.PI / 2;
      vein.rotation.z = -0.28 + index * 0.15;
      vein.position.set(-120 + index * 70, 0.35, -350 + index * 175);
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

  private createFoodMesh() {
    const geometry = new THREE.IcosahedronGeometry(2.2, 1);
    const material = new THREE.MeshBasicMaterial({
      color: '#8ff6ae',
      transparent: true,
      opacity: 0.82,
    });
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

    root.add(body, leftEye, rightEye, mouth, teeth, leftLeg, rightLeg, leftArm, rightArm);
    return { root, body, leftEye, rightEye, mouth, teeth, leftLeg, rightLeg, leftArm, rightArm };
  }

  private updateFood(snapshot: SimulationSnapshot) {
    const visibleFood = snapshot.food.filter((item) => this.isVisible(item.position.x, item.position.y, snapshot.world, 80)).slice(0, maxVisibleFood);

    visibleFood.forEach((food, index) => {
      const position = this.toScenePosition(food.position.x, food.position.y, snapshot.world);
      const pulse = 1 + Math.sin(snapshot.world.tick * 0.05 + food.id) * 0.12;
      this.reusableMatrix.compose(
        new THREE.Vector3(position.x, 3.2 + pulse, position.z),
        new THREE.Quaternion(),
        new THREE.Vector3(pulse, pulse, pulse),
      );
      this.foodMesh.setMatrixAt(index, this.reusableMatrix);
    });

    this.foodMesh.count = visibleFood.length;
    this.foodMesh.instanceMatrix.needsUpdate = true;
  }

  private updateCreatures(snapshot: SimulationSnapshot) {
    const eatingAgents = this.getEatingAgentIds(snapshot);
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

      this.updateCreatureRig(rig, agent, colors.get(agent.speciesId) ?? '#b70913', snapshot.world, snapshot.world.tick, eatingAgents.has(agent.id));
    });
  }

  private updateCreatureRig(rig: CreatureRig, agent: Agent, color: string, world: World, tick: number, isEating: boolean) {
    const position = this.toScenePosition(agent.position.x, agent.position.y, world);
    const direction = Math.atan2(agent.velocity.x, agent.velocity.y || 0.001);
    const gait = Math.sin(tick * 0.12 + agent.id) * 0.6;
    const chew = isEating ? Math.sin(tick * 0.85 + agent.id) * 0.8 : 0;
    const bodyScale = 0.82 + Math.min(0.32, agent.energy / 360);
    const widthScale = 0.82 + agent.dna.social * 0.45;
    const heightScale = 0.84 + agent.dna.fertility * 0.5;

    rig.root.visible = true;
    rig.root.position.set(position.x, 15 + (isEating ? Math.abs(chew) * 0.55 : 0), position.z);
    rig.root.rotation.y = direction;
    rig.root.scale.set(widthScale, bodyScale * heightScale, 1);

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
    rig.rightArm.position.set(12.5, 8 - gait * 2, isEating ? -2.2 : 0);
    rig.leftArm.rotation.z = (isEating ? 0.75 : 0.35) + gait * 0.35;
    rig.rightArm.rotation.z = (isEating ? -0.75 : -0.35) - gait * 0.35;

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
    const color = effect.type === 'death' ? '#ff365b' : effect.type === 'eat' ? '#86efac' : '#f8d56b';
    const ringMaterial = rig.ring.material as THREE.MeshBasicMaterial;
    const coreMaterial = rig.core.material as THREE.MeshBasicMaterial;
    const scale = effect.type === 'birth' ? 1 + progress * 3.8 : effect.type === 'eat' ? 0.7 + progress * 1.4 : 1 + progress * 2.6;
    const opacity = Math.max(0, 1 - progress);

    rig.root.visible = true;
    rig.root.position.set(position.x, 4 + progress * 20, position.z);
    rig.root.scale.setScalar(scale);
    ringMaterial.color.set(color);
    coreMaterial.color.set(color);
    ringMaterial.opacity = opacity * (effect.type === 'death' ? 0.74 : 0.58);
    coreMaterial.opacity = opacity * (effect.type === 'eat' ? 0.78 : 0.38);
    rig.core.position.y = effect.type === 'death' ? progress * 18 : progress * 8;
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
    const distance = Math.hypot(position.x - this.cameraPosition.x, position.z - this.cameraPosition.z);

    return distance <= cameraViewDistance + margin;
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
