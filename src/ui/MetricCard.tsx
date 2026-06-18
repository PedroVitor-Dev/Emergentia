type MetricCardProps = {
  label: string;
  value: number | string;
};

export const MetricCard = ({ label, value }: MetricCardProps) => (
  <div className="metric-card">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);
