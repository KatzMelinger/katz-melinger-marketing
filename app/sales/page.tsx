import type { Metadata } from "next";

import { SalesDashboardClient } from "@/app/sales/sales-dashboard-client";
import { APP_NAME } from "@/lib/app-config";

export const metadata: Metadata = { title: `Intake & Sales | ${APP_NAME}` };

export default function SalesPage() {
  return <SalesDashboardClient />;
}
