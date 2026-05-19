import { useState, useEffect } from 'react';
import { getStatistics } from '../api/chinabidding';
import './BidStatistics.css';

function BidStatistics() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    getStatistics().then(setStats).catch(console.error);
  }, []);

  if (!stats) return <div className="loading">Loading...</div>;

  return (
    <div className="bid-stats">
      <h1>Bidding Statistics</h1>

      <div className="stats-grid">
        <div className="stat-card">
          <h3>Total Projects</h3>
          <p className="stat-number">{stats.total}</p>
        </div>
        <div className="stat-card">
          <h3>New This Week</h3>
          <p className="stat-number">{stats.recentCount}</p>
        </div>
        <div className="stat-card">
          <h3>New Projects</h3>
          <p className="stat-number">{stats.newProjects}</p>
        </div>
        <div className="stat-card">
          <h3>Past Projects</h3>
          <p className="stat-number">{stats.pastProjects}</p>
        </div>
        <div className="stat-card">
          <h3>In Progress</h3>
          <p className="stat-number">{stats.publishedCount}</p>
        </div>
        <div className="stat-card">
          <h3>Closed</h3>
          <p className="stat-number">{stats.closedCount}</p>
        </div>
      </div>

      <div className="region-stats">
        <h2>Top 10 Regions</h2>
        <table className="region-table">
          <thead>
            <tr>
              <th>Region</th>
              <th>Count</th>
            </tr>
          </thead>
          <tbody>
            {stats.topRegions.map((item, index) => (
              <tr key={index}>
                <td>{item.region}</td>
                <td>{item.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default BidStatistics;