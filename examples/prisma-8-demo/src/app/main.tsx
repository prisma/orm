import { PostgresContractSerializer } from '@prisma/orm-postgres/target/runtime';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NotFoundError } from '../errors';
import type { Contract } from '../prisma/contract.d';
import contractJson from '../prisma/contract.json' with { type: 'json' };
import { App } from './App';

function renderApp(json: unknown) {
  const contract = new PostgresContractSerializer().deserializeContract<Contract>(json);
  root.render(
    <StrictMode>
      <App contract={contract} />
    </StrictMode>,
  );
}

const el = document.getElementById('root');
if (!el) throw new NotFoundError('Missing #root element');
const root = createRoot(el);
renderApp(contractJson);

if (import.meta.hot) {
  import.meta.hot.accept('../prisma/contract.json', (mod) => {
    const data = mod ? (mod as unknown as Record<string, unknown>)['default'] : undefined;
    if (data !== undefined) renderApp(data);
  });
}
