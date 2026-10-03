import type { Metadata } from "next";

import { PersonClient } from "@/app/sales/[staffId]/person-client";
import { APP_NAME } from "@/lib/app-config";

export const metadata: Metadata = { title: `Team member | ${APP_NAME}` };

export default async function PersonPage(props: { params: Promise<{ staffId: string }> }) {
  const { staffId } = await props.params;
  return <PersonClient staffId={staffId} />;
}
