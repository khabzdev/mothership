import { Banner } from "@cloudflare/kumo";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { Icon } from "./Icon";

/** What went wrong, under a form: Kumo's error banner. Nothing without an error. */
export function ErrorNote({ error }: { error: { message: string } | null | undefined }) {
  if (!error) return null;
  return (
    <Banner
      variant="error"
      icon={<Icon icon={Alert02Icon} />}
      description={error.message}
      className="error-note"
      role="alert"
    />
  );
}
