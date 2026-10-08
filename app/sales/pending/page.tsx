import type { Metadata } from "next";

import { APP_NAME } from "@/lib/app-config";

import { PendingIntakesClient } from "./pending-client";

export const metadata: Metadata = { title: `Pending Intakes | ${APP_NAME}` };

export default function PendingIntakesPage() {
  return <PendingIntakesClient />;
}
