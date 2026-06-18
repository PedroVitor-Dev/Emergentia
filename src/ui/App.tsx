import { Activity, Pause, Play, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SimulationSnapshot } from '../core/types';
import { renderSimulation } from '../render/canvasRenderer';
import { SimulationEngine } from '../simulation/SimulationEngine';
import { MetricCard } from './MetricCard';
import { SpeciesList } from './SpeciesList';
import { Timeline } from './Timeline';

const renderFrameMs = 1000 / 30;
const dashboardFrameMs = 250;

export const App = () => {
  const engineRef = useRef(new SimulationEngine());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const snapshotRef = useRef<SimulationSnapshot>(engineRef.current.getSnapshot());
  const [isRunning, setIsRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [snapshot, setSnapshot] = useState<SimulationSnapshot>(() => snapshotRef.current);

  useEffect(() => {
    let animationFrame = 0;
    let lastRenderTime = 0;
    let lastDashboardTime = 0;

    const animate = (time: number) => {
      if (time - lastRenderTime < renderFrameMs) {
        animationFrame = window.requestAnimationFrame(animate);
        return;
      }

      lastRenderTime = time;

      if (isRunning) {
        engineRef.current.step(speed);
      }

      const nextSnapshot = engineRef.current.getSnapshot();
      snapshotRef.current = nextSnapshot;
      const canvas = canvasRef.current;

      if (canvas) {
        renderSimulation(canvas, nextSnapshot);
      }

      if (time - lastDashboardTime >= dashboardFrameMs) {
        lastDashboardTime = time;
        setSnapshot(nextSnapshot);
      }

      animationFrame = window.requestAnimationFrame(animate);
    };

    animationFrame = window.requestAnimationFrame(animate);

    return () => window.cancelAnimationFrame(animationFrame);
  }, [isRunning, speed]);

  const dominantShare = useMemo(() => {
    if (!snapshot.stats.dominantSpecies || snapshot.stats.population === 0) {
      return 0;
    }

    return Math.round((snapshot.stats.dominantSpecies.population / snapshot.stats.population) * 100);
  }, [snapshot.stats.dominantSpecies, snapshot.stats.population]);

  const resetSimulation = () => {
    engineRef.current.reset();
    const nextSnapshot = engineRef.current.getSnapshot();
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    setIsRunning(true);
  };

  return (
    <main className="app-shell">
      <section className="lab-stage" aria-label="Emergentia simulation viewport">
        <canvas ref={canvasRef} className="world-canvas" />
        <div className="stage-overlay">
          <div>
            <span className="eyebrow">Artificial Life Laboratory</span>
            <h1>Emergentia</h1>
          </div>
          <div className="control-strip" aria-label="Simulation controls">
            <button
              className="icon-button"
              type="button"
              onClick={() => setIsRunning((value) => !value)}
              aria-label={isRunning ? 'Pause simulation' : 'Play simulation'}
              title={isRunning ? 'Pause simulation' : 'Play simulation'}
            >
              {isRunning ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <label className="speed-control">
              <Activity size={16} />
              <input
                aria-label="Simulation speed"
                max="4"
                min="1"
                onChange={(event) => setSpeed(Number(event.target.value))}
                type="range"
                value={speed}
              />
              <span>{speed}x</span>
            </label>
            <button
              className="icon-button"
              type="button"
              onClick={resetSimulation}
              aria-label="Reset simulation"
              title="Reset simulation"
            >
              <RotateCcw size={18} />
            </button>
          </div>
        </div>
      </section>

      <aside className="dashboard" aria-label="Simulation dashboard">
        <div className="status-block">
          <div>
            <span className="eyebrow">Day {snapshot.world.day}</span>
            <h2>{snapshot.stats.population} agents alive</h2>
          </div>
          <div className="live-pill">
            <Sparkles size={14} />
            {isRunning ? 'Running' : 'Paused'}
          </div>
        </div>

        <div className="metric-grid">
          <MetricCard label="Species" value={snapshot.stats.speciesCount} />
          <MetricCard label="Food" value={snapshot.stats.food} />
          <MetricCard label="Births" value={snapshot.stats.births} />
          <MetricCard label="Deaths" value={snapshot.stats.deaths} />
          <MetricCard label="Avg energy" value={snapshot.stats.averageEnergy.toFixed(1)} />
          <MetricCard label="Avg gen" value={snapshot.stats.averageGeneration.toFixed(1)} />
        </div>

        <div className="dominance-panel">
          <span className="panel-label">Dominant species</span>
          <strong>{snapshot.stats.dominantSpecies?.name ?? 'None'}</strong>
          <div className="progress-track">
            <span style={{ width: `${dominantShare}%`, background: snapshot.stats.dominantSpecies?.color ?? '#ffffff' }} />
          </div>
          <small>{dominantShare}% of living population</small>
        </div>

        <SpeciesList species={snapshot.species} />
        <Timeline events={snapshot.timeline} />
      </aside>
    </main>
  );
};
