import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { keys } from '../api/hooks';
import type { Me } from '../api/types';
import { useHousehold } from '../lib/household';
import { useToast } from './Toast';
import { errorMessage } from './States';

/** The household name, or a switcher when the user belongs to more than one. */
export function HouseholdSwitcher() {
  const { me } = useHousehold();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  if (!me) return null;
  if (me.households.length <= 1) return <strong className="truncate">{me.household.name}</strong>;

  return (
    <select
      className="input household-switch"
      aria-label="Household"
      value={me.household.id}
      onChange={async (e) => {
        try {
          const next = await api.post<Me>('/auth/switch-household', { householdId: e.target.value });
          // Nothing from the previous household may linger on screen.
          qc.clear();
          qc.setQueryData(keys.me, next);
          navigate('/dashboard');
          toast(`Now working in ${next.household.name}`);
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      }}
    >
      {me.households.map((h) => (
        <option key={h.id} value={h.id}>
          {h.name}
          {h.role === 'OWNER' ? '' : ' (member)'}
        </option>
      ))}
    </select>
  );
}
