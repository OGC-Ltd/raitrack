// The organisation a letterhead PDF is made for: the one on screen, by name
// and code (the report number carries the code, "SM-SUKARI-20261117-1240").
// The old template named every fleet "Fleet Tracking".

import { useMemo } from 'react';
import { useCompanies } from '../context/AppContext';
import { ORG_CODE_BY_COMPANY } from '../api/org';

/** @returns {{ companyName: string, orgCode: string | null }} */
export function useLetterheadFleet() {
  const { activeCompany } = useCompanies();
  return useMemo(() => ({
    companyName: activeCompany?.name || 'Fleet',
    orgCode: activeCompany?.code ?? ORG_CODE_BY_COMPANY[activeCompany?.id] ?? null,
  }), [activeCompany]);
}
