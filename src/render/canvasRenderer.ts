import type { Agent, SimulationSnapshot } from '../core/types';

export const renderSimulation = (canvas: HTMLCanvasElement, snapshot: SimulationSnapshot) => {
  const context = canvas.getContext('2d');

  if (!context) {
    return;
  }

  const ratio = Math.min(window.devicePixelRatio || 1, 1.35);
  const rect = canvas.getBoundingClientRect();
  const width = Math.floor(rect.width * ratio);
  const height = Math.floor(rect.height * ratio);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.save();
  context.scale(ratio, ratio);
  context.clearRect(0, 0, rect.width, rect.height);

  drawBackground(context, rect.width, rect.height, snapshot.world.tick);
  drawResourceField(context, snapshot, rect.width, rect.height);

  const scaleX = rect.width / snapshot.world.width;
  const scaleY = rect.height / snapshot.world.height;
  const speciesColors = new Map(snapshot.species.map((item) => [item.id, item.color]));
  const detailedCreatureLimit = 120;

  snapshot.agents.forEach((agent, index) => {
    const color = speciesColors.get(agent.speciesId) ?? '#ffffff';
    const x = agent.position.x * scaleX;
    const y = agent.position.y * scaleY;

    if (index < detailedCreatureLimit) {
      drawCreature(context, agent, color, x, y, snapshot.world.tick);
    } else {
      drawTinyCreature(context, agent, color, x, y, snapshot.world.tick);
    }
  });

  context.restore();
};

const drawBackground = (context: CanvasRenderingContext2D, width: number, height: number, tick: number) => {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0b1110');
  gradient.addColorStop(0.48, '#121918');
  gradient.addColorStop(1, '#181210');

  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  drawTerrainLayer(context, width, height, tick, 0.18, '#20332a', 0.58);
  drawTerrainLayer(context, width, height, tick, 0.34, '#253026', 0.42);
  drawWaterVeins(context, width, height, tick);

  context.strokeStyle = 'rgba(236, 255, 239, 0.045)';
  context.lineWidth = 1;

  for (let x = -80; x < width + 80; x += 74) {
    const drift = Math.sin(tick * 0.004 + x * 0.02) * 8;
    context.beginPath();
    context.moveTo(x + drift, 0);
    context.lineTo(x - drift * 0.4, height);
    context.stroke();
  }

  for (let y = -60; y < height + 60; y += 74) {
    const drift = Math.cos(tick * 0.004 + y * 0.018) * 8;
    context.beginPath();
    context.moveTo(0, y + drift);
    context.lineTo(width, y - drift * 0.3);
    context.stroke();
  }
};

const drawTerrainLayer = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  tick: number,
  speed: number,
  color: string,
  alpha: number,
) => {
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = color;

  for (let index = 0; index < 9; index += 1) {
    const seed = index * 131;
    const x = ((seed * 17 + tick * speed) % (width + 260)) - 130;
    const y = height * (0.14 + ((index * 37) % 72) / 100);
    const radiusX = 130 + ((index * 43) % 110);
    const radiusY = 32 + ((index * 29) % 52);

    context.beginPath();
    context.ellipse(x, y + Math.sin(tick * 0.006 + index) * 14, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
};

const drawWaterVeins = (context: CanvasRenderingContext2D, width: number, height: number, tick: number) => {
  context.save();
  context.strokeStyle = 'rgba(97, 190, 173, 0.18)';
  context.lineWidth = 2;

  for (let index = 0; index < 5; index += 1) {
    const baseY = height * (0.18 + index * 0.17);
    const offset = (tick * 0.12 + index * 90) % (width + 160);

    context.beginPath();
    for (let x = -160; x <= width + 160; x += 36) {
      const y = baseY + Math.sin((x + offset) * 0.013 + index) * 22;
      if (x === -160) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.stroke();
  }

  context.restore();
};

const drawResourceField = (context: CanvasRenderingContext2D, snapshot: SimulationSnapshot, width: number, height: number) => {
  const scaleX = width / snapshot.world.width;
  const scaleY = height / snapshot.world.height;

  snapshot.food.forEach((food) => {
    const x = food.position.x * scaleX;
    const y = food.position.y * scaleY;
    const radius = 1.3 + food.energy * 0.035;

    context.beginPath();
    context.fillStyle = 'rgba(144, 246, 177, 0.66)';
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  });
};

const drawCreature = (
  context: CanvasRenderingContext2D,
  agent: Agent,
  color: string,
  x: number,
  y: number,
  tick: number,
) => {
  const energyScale = 0.82 + Math.min(0.24, agent.energy / 420);
  const bodyWidth = (16 + agent.dna.social * 6 + agent.generation * 0.03) * energyScale;
  const bodyHeight = (18 + agent.dna.fertility * 7) * energyScale;
  const direction = Math.atan2(agent.velocity.y, agent.velocity.x || 0.001);
  const lean = Math.max(-0.22, Math.min(0.22, Math.hypot(agent.velocity.x, agent.velocity.y) * 0.08));
  const gait = Math.sin(tick * 0.08 + agent.id) * 2.4;
  const outline = '#030504';
  const darkColor = shadeColor(color, -36);
  const lightColor = shadeColor(color, 28);

  context.save();
  context.translate(x, y);
  context.rotate(direction * 0.18);
  context.translate(0, Math.sin(tick * 0.035 + agent.id) * 1.4);

  context.beginPath();
  context.fillStyle = 'rgba(0, 0, 0, 0.26)';
  context.ellipse(0, bodyHeight * 0.58, bodyWidth * 0.55, bodyHeight * 0.13, 0, 0, Math.PI * 2);
  context.fill();

  drawLimb(context, -bodyWidth * 0.56, -bodyHeight * 0.1, -bodyWidth * 0.9, gait, bodyHeight, darkColor, outline);
  drawLimb(context, bodyWidth * 0.55, -bodyHeight * 0.02, bodyWidth * 0.88, -gait, bodyHeight, darkColor, outline);
  drawLeg(context, -bodyWidth * 0.25, bodyHeight * 0.42, gait, bodyHeight, darkColor, outline);
  drawLeg(context, bodyWidth * 0.25, bodyHeight * 0.42, -gait, bodyHeight, darkColor, outline);

  drawRoundedBody(context, bodyWidth, bodyHeight, lean, color, darkColor, outline);
  drawFace(context, bodyWidth, bodyHeight, agent, tick, outline);
  drawBodyMarks(context, bodyWidth, bodyHeight, agent, lightColor, darkColor);

  context.restore();
};

const drawTinyCreature = (
  context: CanvasRenderingContext2D,
  agent: Agent,
  color: string,
  x: number,
  y: number,
  tick: number,
) => {
  const width = 10 + agent.dna.social * 4;
  const height = 11 + agent.dna.fertility * 4;
  const bob = Math.sin(tick * 0.035 + agent.id) * 0.8;

  context.save();
  context.translate(x, y + bob);
  context.rotate(Math.atan2(agent.velocity.y, agent.velocity.x || 0.001) * 0.15);

  context.beginPath();
  context.fillStyle = 'rgba(0, 0, 0, 0.24)';
  context.ellipse(0, height * 0.58, width * 0.55, height * 0.14, 0, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.fillStyle = color;
  context.strokeStyle = '#030504';
  context.lineWidth = 2;
  context.roundRect(-width / 2, -height / 2, width, height, 4);
  context.fill();
  context.stroke();

  context.beginPath();
  context.fillStyle = '#030504';
  context.ellipse(-width * 0.18, -height * 0.12, 1.8, 2.5, -0.2, 0, Math.PI * 2);
  context.ellipse(width * 0.18, -height * 0.12, 1.8, 2.5, 0.2, 0, Math.PI * 2);
  context.fill();

  context.restore();
};

const drawRoundedBody = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  lean: number,
  color: string,
  darkColor: string,
  outline: string,
) => {
  context.beginPath();
  context.moveTo(-width * 0.42 + lean, -height * 0.5);
  context.quadraticCurveTo(-width * 0.55, -height * 0.55, -width * 0.58, -height * 0.34);
  context.lineTo(-width * 0.5, height * 0.42);
  context.quadraticCurveTo(-width * 0.46, height * 0.56, -width * 0.24, height * 0.52);
  context.lineTo(width * 0.33, height * 0.47);
  context.quadraticCurveTo(width * 0.55, height * 0.45, width * 0.52, height * 0.18);
  context.lineTo(width * 0.48, -height * 0.37);
  context.quadraticCurveTo(width * 0.28, -height * 0.56, -width * 0.42 + lean, -height * 0.5);
  context.closePath();
  context.fillStyle = color;
  context.strokeStyle = outline;
  context.lineWidth = 3;
  context.fill();
  context.stroke();

  context.beginPath();
  context.moveTo(-width * 0.42, -height * 0.38);
  context.quadraticCurveTo(-width * 0.05, -height * 0.55, width * 0.38, -height * 0.42);
  context.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  context.lineWidth = 2;
  context.stroke();

  context.beginPath();
  context.moveTo(-width * 0.34, height * 0.38);
  context.quadraticCurveTo(0, height * 0.58, width * 0.34, height * 0.35);
  context.strokeStyle = darkColor;
  context.lineWidth = 3;
  context.stroke();
};

const drawFace = (context: CanvasRenderingContext2D, width: number, height: number, agent: Agent, tick: number, outline: string) => {
  const blink = Math.sin(tick * 0.018 + agent.id * 0.7) > 0.96 ? 0.18 : 1;
  const eyeSize = 3.8 + agent.dna.vision * 3.2;
  const mouthWidth = width * (0.48 + agent.dna.aggression * 0.22);

  drawEye(context, -width * 0.22, -height * 0.18, eyeSize, eyeSize * blink, outline);
  drawEye(context, width * 0.2, -height * 0.2, eyeSize * 0.92, eyeSize * blink, outline);

  context.beginPath();
  context.fillStyle = outline;
  context.ellipse(0, height * 0.12, mouthWidth, height * 0.17, 0.02, 0, Math.PI * 2);
  context.fill();

  const teeth = 3 + Math.round(agent.dna.aggression * 4);
  for (let index = 0; index < teeth; index += 1) {
    const toothX = -mouthWidth * 0.68 + (index / Math.max(1, teeth - 1)) * mouthWidth * 1.36;
    const toothY = height * 0.05 + Math.sin(index + agent.id) * 1.4;
    context.beginPath();
    context.fillStyle = '#f4f5ed';
    context.roundRect(toothX - 2.3, toothY, 4.6, 7.2, 2);
    context.fill();
  }

  context.beginPath();
  context.strokeStyle = 'rgba(255, 151, 161, 0.72)';
  context.lineWidth = 2;
  context.ellipse(0, height * 0.12, mouthWidth * 0.78, height * 0.1, 0.02, 0.15, Math.PI - 0.18);
  context.stroke();
};

const drawEye = (context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, outline: string) => {
  context.beginPath();
  context.fillStyle = outline;
  context.ellipse(x, y, width, height, -0.16, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.fillStyle = 'rgba(255, 248, 248, 0.95)';
  context.ellipse(x - width * 0.28, y - height * 0.26, width * 0.25, Math.max(1, height * 0.22), -0.4, 0, Math.PI * 2);
  context.fill();
};

const drawBodyMarks = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  agent: Agent,
  lightColor: string,
  darkColor: string,
) => {
  context.strokeStyle = darkColor;
  context.lineWidth = 1.4;

  for (let index = 0; index < 3; index += 1) {
    const markX = -width * 0.32 + index * width * 0.28;
    const markY = -height * 0.34 + ((agent.id + index * 9) % 12);

    context.beginPath();
    context.moveTo(markX, markY);
    context.lineTo(markX + 6, markY - 8);
    context.stroke();
  }

  if (agent.dna.social > 0.62) {
    context.save();
    context.translate(-width * 0.08, -height * 0.5);
    context.rotate(-0.38);
    context.fillStyle = '#f7f7f1';
    context.strokeStyle = '#020302';
    context.lineWidth = 2;
    context.roundRect(-2.5, -7, 5, 14, 2);
    context.roundRect(-7, -2.5, 14, 5, 2);
    context.fill();
    context.stroke();
    context.restore();
  }

  context.beginPath();
  context.fillStyle = lightColor;
  context.globalAlpha = 0.18;
  context.ellipse(-width * 0.17, -height * 0.28, width * 0.22, height * 0.11, -0.25, 0, Math.PI * 2);
  context.fill();
  context.globalAlpha = 1;
};

const drawLimb = (
  context: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  gait: number,
  bodyHeight: number,
  color: string,
  outline: string,
) => {
  context.beginPath();
  context.strokeStyle = outline;
  context.lineWidth = 8;
  context.lineCap = 'round';
  context.moveTo(startX, startY);
  context.quadraticCurveTo((startX + endX) / 2, bodyHeight * 0.14 + gait, endX, bodyHeight * 0.06 + gait);
  context.stroke();

  context.beginPath();
  context.strokeStyle = color;
  context.lineWidth = 5;
  context.moveTo(startX, startY);
  context.quadraticCurveTo((startX + endX) / 2, bodyHeight * 0.14 + gait, endX, bodyHeight * 0.06 + gait);
  context.stroke();
};

const drawLeg = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  gait: number,
  bodyHeight: number,
  color: string,
  outline: string,
) => {
  context.beginPath();
  context.strokeStyle = outline;
  context.lineWidth = 9;
  context.lineCap = 'round';
  context.moveTo(x, y);
  context.lineTo(x + gait, y + bodyHeight * 0.3);
  context.stroke();

  context.beginPath();
  context.strokeStyle = color;
  context.lineWidth = 6;
  context.moveTo(x, y);
  context.lineTo(x + gait, y + bodyHeight * 0.3);
  context.stroke();
};

const shadeColor = (hex: string, amount: number) => {
  const normalized = hex.replace('#', '');
  const numeric = Number.parseInt(normalized.length === 3 ? normalized.repeat(2) : normalized, 16);
  const red = Math.max(0, Math.min(255, (numeric >> 16) + amount));
  const green = Math.max(0, Math.min(255, ((numeric >> 8) & 255) + amount));
  const blue = Math.max(0, Math.min(255, (numeric & 255) + amount));

  return `rgb(${red}, ${green}, ${blue})`;
};
