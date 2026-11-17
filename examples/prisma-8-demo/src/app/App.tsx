import type { Contract } from '../prisma/contract.d';
import './App.css';
import { ContractView } from './ContractView';

export function App({ contract }: { contract: Contract }) {
  return (
    <>
      <h1>Prisma 8 Contract Viewer</h1>
      <p className="subtitle">
        This page is loaded from contract.json. Edit contract.ts to see changes.
      </p>
      <ContractView contract={contract} />
    </>
  );
}
