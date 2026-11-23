import { redirect } from "next/navigation";

export default function AppSettingsRedirectPage() {
  redirect("/app/providers");
}
