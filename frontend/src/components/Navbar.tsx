"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectWallet } from "@/components/ConnectWallet";

const NAV = ["Dashboard", "Setup", "Checkin", "Claim"];

export function Navbar() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 border-b border-card-border"
      style={{
        background: "color-mix(in oklab, var(--background) 82%, transparent)",
        backdropFilter: "blur(10px)",
      }}
    >
      <Link href="/" className="flex items-center gap-3">
        <span className="font-display font-extrabold text-2xl tracking-tighter uppercase flex items-center">
          <span className="text-muted-foreground mr-2">ΟΒΟΛΟΣ</span>
          OBOL.
        </span>
        <span className="text-[10px] font-mono text-muted-foreground ml-2 hidden lg:block tracking-widest">
          [ZK INHERITANCE ON STELLAR]
        </span>
      </Link>

      <div className="hidden md:flex flex-1 justify-center">
        <div className="flex items-center gap-8 text-xs font-bold uppercase tracking-widest">
          {NAV.map((item) => {
            const href = `/${item.toLowerCase()}`;
            const active = pathname === href;
            return (
              <Link
                key={item}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`relative py-2 group transition-colors ${
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item}
                <span
                  className={`absolute bottom-0 left-0 w-full h-[1px] origin-left transition-transform duration-300 ${
                    active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
                  }`}
                  style={{ background: active ? "var(--accent)" : "var(--foreground)" }}
                />
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-5">
        <a
          href="https://stellar.expert/explorer/testnet"
          target="_blank"
          rel="noreferrer"
          className="hidden sm:flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
        >
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--accent)" }}
          />
          Testnet
        </a>
        <ConnectWallet />
      </div>
    </nav>
  );
}
