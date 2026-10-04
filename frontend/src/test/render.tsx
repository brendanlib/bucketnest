import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { HouseholdProvider } from '../lib/household';

export function renderWithHousehold(ui: ReactNode) {
  return render(
    <MemoryRouter>
      <HouseholdProvider me={null}>{ui}</HouseholdProvider>
    </MemoryRouter>,
  );
}
