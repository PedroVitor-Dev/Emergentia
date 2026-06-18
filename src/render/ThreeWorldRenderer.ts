import * as THREE from 'three';
import type { Agent, SimulationSnapshot, World } from '../core/types';

const worldScale = 0.5;
const maxVisibleCreatures = 160;
const maxVisibleFood = 640;
const minZoom = 0.45;
const maxZoom = 3.4;

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

export class ThreeWorldRenderer {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5000);
  private readonly target = new THREE.Vector3(0, 0, 0);
  private readonly rayPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly foodMesh: THREE.InstancedMesh;
  private readonly creaturePool: CreatureRig[] = [];
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly reusableMatrix = new THREE.Matrix4();
  private readonly reusableColor = new THREE.Color();
  private readonly resizeObserver: ResizeObserver;
  private readonly pointer = {
    active: false,
    lastX: 0,
    lastY: 0,
  };
  private viewSize = 760;
  private zoom = 1.05;
  private width = 1;
  private height = 1;

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

    this.scene.background = new THREE.Color('#070908');
    this.scene.fog = new THREE.FogExp2('#070908', 0.00075);

    this.foodMesh = this.createFoodMesh();
    this.scene.add(this.foodMesh);

    this.createWorldStage();
    this.createLights();
    this.createCreaturePool();
    this.attachNavigation();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  render(snapshot: SimulationSnapshot) {
    this.updateCamera();
    this.updateFood(snapshot);
    this.updateCreatures(snapshot);
    this.animateWorld(snapshot.world.tick);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.resizeObserver.disconnect();
    this.container.removeEventListener('pointerdown', this.handlePointerDown);
    this.container.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    this.container.removeEventListener('wheel', this.handleWheel);
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
    const aspect = this.width / this.height;
    const halfHeight = this.viewSize / this.zoom / 2;
    const halfWidth = halfHeight * aspect;

    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.position.set(this.target.x, 720 / this.zoom, this.target.z + 620 / this.zoom);
    this.camera.lookAt(this.target);
    this.camera.updateProjectionMatrix();
  }

  private attachNavigation() {
    this.container.addEventListener('pointerdown', this.handlePointerDown);
    this.container.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    this.container.addEventListener('wheel', this.handleWheel, { passive: false });
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
    const panSpeed = 1.75 / this.zoom;

    this.target.x -= dx * panSpeed;
    this.target.z -= dy * panSpeed;
    this.pointer.lastX = event.clientX;
    this.pointer.lastY = event.clientY;
  };

  private handlePointerUp = () => {
    this.pointer.active = false;
  };

  private handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    this.zoom = THREE.MathUtils.clamp(this.zoom + direction * 0.14 * this.zoom, minZoom, maxZoom);
  };

  private createWorldStage() {
    const terrainMaterial = new THREE.MeshStandardMaterial({
      color: '#171d17',
      roughness: 0.95,
      metalness: 0.02,
    });
    const terrain = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200, 16, 16), terrainMaterial);
    terrain.name = 'living-terrain';
    terrain.rotation.x = -Math.PI / 2;
    this.scene.add(terrain);

    const grid = new THREE.GridHelper(1200, 32, '#314437', '#1f2a24');
    grid.position.y = 0.18;
    this.scene.add(grid);

    for (let index = 0; index < 9; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: index % 2 === 0 ? '#27352d' : '#2f2b23',
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      });
      const patch = new THREE.Mesh(new THREE.CircleGeometry(38 + (index % 4) * 18, 24), material);
      patch.name = 'biome-patch';
      patch.rotation.x = -Math.PI / 2;
      patch.scale.set(1.8 + (index % 3) * 0.45, 0.65 + (index % 2) * 0.35, 1);
      patch.position.set(((index * 137) % 920) - 460, 0.25, ((index * 229) % 920) - 460);
      this.scene.add(patch);
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

      this.updateCreatureRig(rig, agent, colors.get(agent.speciesId) ?? '#b70913', snapshot.world, snapshot.world.tick);
    });
  }

  private updateCreatureRig(rig: CreatureRig, agent: Agent, color: string, world: World, tick: number) {
    const position = this.toScenePosition(agent.position.x, agent.position.y, world);
    const direction = Math.atan2(agent.velocity.x, agent.velocity.y || 0.001);
    const gait = Math.sin(tick * 0.12 + agent.id) * 0.6;
    const bodyScale = 0.82 + Math.min(0.32, agent.energy / 360);
    const widthScale = 0.82 + agent.dna.social * 0.45;
    const heightScale = 0.84 + agent.dna.fertility * 0.5;

    rig.root.visible = true;
    rig.root.position.set(position.x, 15, position.z);
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

    rig.body.position.set(0, 12, 0);
    rig.body.scale.set(1, 1, 1);

    const eyeSize = 0.78 + agent.dna.vision * 0.38;
    rig.leftEye.position.set(-5, 17, -7.2);
    rig.rightEye.position.set(5, 17, -7.2);
    rig.leftEye.scale.set(eyeSize, eyeSize, eyeSize);
    rig.rightEye.scale.set(eyeSize, eyeSize, eyeSize);

    rig.mouth.position.set(0, 9.5, -7.4);
    rig.mouth.scale.set(1 + agent.dna.aggression * 0.45, 1, 1);

    rig.leftLeg.position.set(-5.2, -4.5 + gait, 0);
    rig.rightLeg.position.set(5.2, -4.5 - gait, 0);
    rig.leftArm.position.set(-12.5, 8 + gait * 2, 0);
    rig.rightArm.position.set(12.5, 8 - gait * 2, 0);
    rig.leftArm.rotation.z = 0.35 + gait * 0.35;
    rig.rightArm.rotation.z = -0.35 - gait * 0.35;

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
    const aspect = this.width / this.height;
    const halfHeight = this.viewSize / this.zoom / 2 + margin;
    const halfWidth = halfHeight * aspect + margin;

    return (
      position.x >= this.target.x - halfWidth &&
      position.x <= this.target.x + halfWidth &&
      position.z >= this.target.z - halfHeight &&
      position.z <= this.target.z + halfHeight
    );
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
