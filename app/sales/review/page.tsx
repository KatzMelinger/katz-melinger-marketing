import type { Metadata } from "next";

import { ReviewClient } from "@/app/sales/review/review-client";
import { APP_NAME } from "@/lib/app-config";

export const metadata: Metadata = { title: `Review signed leads | ${APP_NAME}` };

export default function ReviewPage() {
  return <ReviewClient />;
}
