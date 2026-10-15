import {
  LayoutDashboard,
  Stethoscope,
  Building2,
  CalendarDays,
  Users,
  Wallet,
} from "lucide-svelte";
import type { Pagina } from "./types";

export const navigation = [
  {
    id: "resumo" as Pagina,
    label: "Visão geral",
    icon: LayoutDashboard,
    available: true,
  },
  {
    id: "medicos" as Pagina,
    label: "Médicos",
    icon: Stethoscope,
    available: true,
  },
  {
    id: "instituicoes",
    label: "Instituições",
    icon: Building2,
    available: false,
  },
  { id: "plantoes", label: "Plantões", icon: CalendarDays, available: false },
  { id: "usuarios", label: "Usuários", icon: Users, available: false },
  { id: "financeiro", label: "Financeiro", icon: Wallet, available: false },
];
