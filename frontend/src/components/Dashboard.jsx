import { useNavigate } from 'react-router-dom';
import './Dashboard.css';

function Dashboard() {
  const navigate = useNavigate();

  return (
    <div className="dashboard">
      <h1 className="dashboard-title">Select Module</h1>
      <div className="dashboard-cards">
        <div className="dashboard-card" onClick={() => navigate('/calendar')}>
          <div className="card-icon calendar-icon">📅</div>
          <h2>Calendar</h2>
          <p>Schedule Management - Create, view and manage your schedule</p>
        </div>
        <div className="dashboard-card" onClick={() => navigate('/chinabidding')}>
          <div className="card-icon bid-icon">📋</div>
          <h2>ChinaBidding</h2>
          <p>Tender Information - Scrape and analyze China bidding website projects</p>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;