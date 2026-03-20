/**
 * SheetsApp — top-level routing for the sheets feature
 *
 * Mounted at /sheets/* in the main App router.
 */

import { Routes, Route } from 'react-router-dom';
import SheetList from '../components/sheets/SheetList';
import SheetEditor from '../components/sheets/SheetEditor';

export default function SheetsApp() {
  return (
    <Routes>
      <Route index element={<SheetList />} />
      <Route path=":id" element={<SheetEditor />} />
    </Routes>
  );
}
