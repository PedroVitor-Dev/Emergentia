import type { SimulationSnapshot } from '../core/types';

export const renderSimulation = (canvas: HTMLCanvasElement, snapshot: SimulationSnapshot) => {
  const context = canvas.getContext('2d');

  if (!context) {
    return;
  }

  const ratio = window.devicePixelRatio || 1;
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
  drawBackground(context, rect.width, rect.height);

  const scaleX = rect.width / snapshot.world.width;
  const scaleY = rect.height / snapshot.world.height;

  snapshot.food.forEach((food) => {
    const x = food.position.x * scaleX;
    const y = food.position.y * scaleY;
    context.beginPath();
    context.fillStyle = 'rgba(139, 255, 183, 0.72)';
    context.arc(x, y, 1.2 + food.energy * 0.03, 0, Math.PI * 2);
    context.fill();
  });

  snapshot.agents.forEach((agent) => {
    const species = snapshot.species.find((item) => item.id === agent.speciesId);
    const x = agent.position.x * scaleX;
    const y = agent.position.y * scaleY;
    const radius = 2.8 + Math.min(2.2, agent.generation * 0.08);

    context.beginPath();
    context.fillStyle = species?.color ?? '#ffffff';
    context.shadowColor = species?.color ?? '#ffffff';
    context.shadowBlur = 7;
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;

    if (agent.energy > 95) {
      context.beginPath();
      context.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      context.lineWidth = 1;
      context.arc(x, y, radius + 3, 0, Math.PI * 2);
      context.stroke();
    }
  });

  context.restore();
};

const drawBackground = (context: CanvasRenderingContext2D, width: number, height: number) => {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#09110f');
  gradient.addColorStop(0.45, '#101719');
  gradient.addColorStop(1, '#161314');

  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.strokeStyle = 'rgba(255, 255, 255, 0.035)';
  context.lineWidth = 1;

  for (let x = 0; x < width; x += 48) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  for (let y = 0; y < height; y += 48) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
};
