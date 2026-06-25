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
        <div className="dashboard-card" onClick={() => navigate('/customers')}>
          <div className="card-icon customer-icon">🤝</div>
          <h2>Customers</h2>
          <p>CRM - Manage customers, tiers, tags, visit history and map distribution</p>
        </div>
        <div className="dashboard-card" onClick={() => navigate('/trips')}>
          <div className="card-icon trip-icon">🗺️</div>
          <h2>Trips</h2>
          <p>行程安排 - 选择客户自动生成带地图的拜访行程，可分享给任何人</p>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;