import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { OnThisPage } from "@/components/docs/on-this-page";

export default function DocsLayout({ children }: LayoutProps<"/docs">) {
  return (
    <div className="mx-auto grid w-full max-w-[88rem] flex-1 grid-cols-1 gap-x-10 px-4 sm:px-6 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_12rem]">
      <aside className="pt-6 lg:border-soft-r lg:pt-0">
        <DocsSidebar />
      </aside>
      <div className="min-w-0 pt-10 pb-24 lg:pt-14">
        <div className="mx-auto max-w-[46rem]">{children}</div>
      </div>
      <aside className="hidden xl:block">
        <OnThisPage />
      </aside>
    </div>
  );
}
