import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from '../utils/anchoredToast';
import { useBands } from '../context/BandsContext';
import { useAuth } from '../context/AuthContext';
import BandManagementPanel from '../components/BandManagementPanel';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

export default function BandMembersPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    bands,
    loading,
    leaveBand,
    deleteBand,
  } = useBands();

  const band = bands.find((entry) => entry.id === id) ?? null;

  useDocumentTitle(band ? `${band.name} Members` : 'Band Members');
  const [busyDeleteBand, setBusyDeleteBand] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');

  if (loading && !band) {
    return <p className="bands-status">Loading band…</p>;
  }

  if (!band || !id) {
    return (
      <section className="bands-page">
        <p className="bands-status">Band not found.</p>
        <Link to="/bands" className="btn btn--secondary">Back to bands</Link>
      </section>
    );
  }

  const isOwner = band.ownerId === user?.id;
  const canEditBand = isOwner || band.memberRoles[user?.id ?? ''] === 'editor';

  const handleDeleteBand = async () => {
    if (deleteConfirmName !== band.name) return;

    setBusyDeleteBand(true);
    const error = await deleteBand(band.id);
    setBusyDeleteBand(false);

    if (error) {
      toast.error(error);
      return;
    }

    toast.success('Band deleted.');
    navigate('/bands');
  };

  return (
    <section className="bands-page">
      <header className="bands-header">
        <div>
          <h1>{band.name}</h1>
          <p>Manage members and roles for this band.</p>
        </div>
      </header>

      <Link to={`/bands/${band.id}/library`} className="btn btn--secondary">
        Back to band library
      </Link>

      <div className="modal-content">
        <BandManagementPanel
          band={band}
          canEditBand={canEditBand}
          isOwner={isOwner}
          showLeaveCurrentUser
          onLeaveCurrentUser={() => leaveBand(band.id)}
          onLeaveSuccess={() => navigate('/bands')}
        />

        {isOwner && (
          <section className="bands-panel bands-panel--danger">
            <h3>Danger zone</h3>
            {showDeleteConfirm ? (
              <div className="bands-delete-confirm">
                <p>Type <strong>{band.name}</strong> to confirm deletion. This cannot be undone.</p>
                <label className="share-menu-field">
                  <input
                    type="text"
                    value={deleteConfirmName}
                    onChange={(e) => setDeleteConfirmName(e.target.value)}
                    placeholder={band.name}
                    autoFocus
                  />
                </label>
                <div className="bands-delete-confirm-actions">
                  <button
                    type="button"
                    className="btn btn--danger"
                    disabled={busyDeleteBand || deleteConfirmName !== band.name}
                    onClick={() => void handleDeleteBand()}
                  >
                    {busyDeleteBand ? 'Deleting…' : 'Delete band'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={busyDeleteBand}
                    onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmName(''); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => setShowDeleteConfirm(true)}
              >
                Delete band
              </button>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
