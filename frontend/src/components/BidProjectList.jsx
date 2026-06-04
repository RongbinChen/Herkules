import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProjects, triggerScrape, searchByKeyword } from '../api/chinabidding';
import './BidProjectList.css';

const PREDEFINED_TAGS = ['georg', 'pomini', 'INNSE', 'DANIELI', 'SMS', 'VAI'];

function BidProjectList() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [filters, setFilters] = useState({ biddingType: 'NEW', status: '' });
  const [searchKeyword, setSearchKeyword] = useState('');

  const fetchProjects = async (page = 1) => {
    setLoading(true);
    try {
      const params = { page, limit: 20, ...filters };
      const result = await getProjects(params);
      setProjects(result.data);
      setPagination(result.pagination);
    } catch (error) {
      console.error('Failed to fetch projects:', error);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleScrape = async () => {
    if (confirm('Scrape latest data?')) {
      await triggerScrape(filters.biddingType);
      fetchProjects();
    }
  };

  const handlePageChange = (newPage) => {
    fetchProjects(newPage);
  };

  const handleTagClick = async (tag) => {
    setSearchLoading(true);
    setSearchKeyword(tag);
    try {
      const result = await searchByKeyword(tag);
      setProjects(result.data || []);
      setPagination({ page: 1, totalPages: 1, total: result.count || 0 });
    } catch (error) {
      console.error('Search failed:', error);
    }
    setSearchLoading(false);
  };

  const handleSearch = () => {
    if (searchKeyword.trim()) {
      handleTagClick(searchKeyword.trim());
    }
  };

  return (
    <div className="bid-list">
      <div className="bid-list-header">
        <div className="bid-list-header-left">
          <button className="back-btn" onClick={() => navigate('/')} title="Back to module selection">
            ← Modules
          </button>
          <h1>Bid Project List</h1>
        </div>
        <button className="scrape-btn" onClick={handleScrape}>Scrape Data</button>
      </div>

      <div className="bid-tags">
        <span className="tags-label">Quick Search:</span>
        {PREDEFINED_TAGS.map(tag => (
          <button
            key={tag}
            className={`tag-btn ${searchKeyword === tag ? 'active' : ''}`}
            onClick={() => handleTagClick(tag)}
          >
            {tag}
          </button>
        ))}
      </div>

      <div className="bid-filters">
        <select value={filters.biddingType} onChange={(e) => setFilters({ ...filters, biddingType: e.target.value })}>
          <option value="NEW">New Projects</option>
          <option value="PAST">Past Projects</option>
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">All Status</option>
          <option value="PUBLISHED">Published</option>
          <option value="CLOSED">Closed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
        <button className="filter-btn" onClick={() => fetchProjects(1)}>Filter</button>
        {searchKeyword && (
          <button className="filter-btn" onClick={() => { setSearchKeyword(''); fetchProjects(1); }}>
            Clear Search
          </button>
        )}
      </div>

      {searchLoading || loading ? (
        <div className="loading">Loading...</div>
      ) : (
        <>
          <table className="bid-table">
            <thead>
              <tr>
                <th>Project Name</th>
                <th>Project Code</th>
                <th>Region</th>
                <th>Publish Date</th>
                <th>Deadline</th>
                <th>Budget</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project, index) => (
                <tr key={project.id || index}>
                  <td>{project.projectName || '-'}</td>
                  <td>{project.projectCode || '-'}</td>
                  <td>{project.region || '-'}</td>
                  <td>{project.publishDate ? new Date(project.publishDate).toLocaleDateString() : '-'}</td>
                  <td>{project.deadline ? new Date(project.deadline).toLocaleDateString() : '-'}</td>
                  <td>{project.budget || '-'}</td>
                  <td><span className={`status-badge ${project.status?.toLowerCase()}`}>{project.status || '-'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pagination">
            <button disabled={pagination.page <= 1 || searchKeyword} onClick={() => handlePageChange(pagination.page - 1)}>Previous</button>
            <span>Page {pagination.page} / {pagination.totalPages || 1}, Total {pagination.total}</span>
            <button disabled={pagination.page >= pagination.totalPages || searchKeyword} onClick={() => handlePageChange(pagination.page + 1)}>Next</button>
          </div>
        </>
      )}
    </div>
  );
}

export default BidProjectList;