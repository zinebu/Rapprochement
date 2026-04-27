// React hooks
export { useMemo, useState, useRef, useEffect } from "react";

// Router
export { useNavigate } from "react-router-dom";

// UI Components - Card
export {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
  CardDescription,
} from "@/components/ui/card";

// UI Components - Table
export {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// UI Components - Forms
export { Button } from "@/components/ui/button";
export { Input } from "@/components/ui/input";
export { Label } from "@/components/ui/label";
export {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
export { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
export { Separator } from "@/components/ui/separator";

// UI Components - Dialog
export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
export { ScrollArea } from "@/components/ui/scroll-area";
export {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
export {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Custom Components
export { StatusBadge } from "@/components/StatusBadge";
export { StatCard } from "@/components/StatCard";

// Mock Data & Types
export {
  mockBankAccounts,
  mockTransactions,
  mockInvoices,
  formatDate,
  type BankAccount,
  type BankTransaction,
  type Invoice,
} from "@/lib/mock-data";

export function formatCurrency(
  amount: number,
  currency: string = "EUR",
  locale = "fr-FR"
) {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const safeCurrency = currency?.trim() || "EUR";

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: safeCurrency,
    }).format(safeAmount);
  } catch {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "EUR",
    }).format(safeAmount);
  }
}

// Icons - Common
export {
  Plus,
  Upload,
  Check,
  Eye,
  FileText,
  Cloud,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Layers,
  Badge,
  Search,
  RotateCcw,
  CalendarClock,
  Receipt,
  Wallet,
  Landmark,
  ArrowLeftRight,
  LayoutGrid,
  Minimize2,
  LayoutList,
  Clock,
  TrendingUp,
  TrendingDown,
  Download,
  BarChart3,
  FileSearch,
  Link2,
  HelpCircle,
  Briefcase,
  ArrowDownToLine,
  Building2,
  Undo2,
  ArrowRight,
  CalendarDays,
  Hash,
  Tag,
  Info,
  MoreHorizontal,
  Users,
  Shield,
  DollarSign,
  ArrowUpRight,
  Save,
  SlidersHorizontal,
  Pencil,
  CalendarPlus,
  X,
} from "lucide-react";

// Charts
export {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Legend,
  Tooltip as RechartsTooltip,
} from "recharts";

// Notifications
export { toast } from "sonner";