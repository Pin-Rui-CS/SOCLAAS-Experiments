import { AppShell } from "@/components/shell/AppShell";

export default function ShellLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
