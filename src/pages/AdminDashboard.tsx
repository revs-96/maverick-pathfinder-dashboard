import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { 
  Users, 
  BarChart3, 
  TrendingUp, 
  Clock, 
  Download,
  Search,
  Filter,
  Brain,
  LogOut,
  UserCircle,
  CheckCircle,
  AlertCircle,
  UserPlus,
  Rocket,
  Send,
  ChevronDown,
  X,
  Bell
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Legend } from 'recharts';
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import BatchManagement from "@/components/BatchManagement";
import TraineeOnboarding from "@/components/TraineeOnboarding";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import * as Popover from '@radix-ui/react-popover';
import { motion, AnimatePresence } from 'framer-motion';
import MentorOnboarding from "@/components/MentorOnboarding";

// Local type for batch
interface BatchForCount {
  phase: number;
  is_next_batch: boolean;
}

interface OverflowBatch {
  _id: string;
  trainees: { name: string; email: string; skill: string }[];
}

// Add at the top, after imports
interface PhaseDistributionItem {
  phase: number;
  skill: string;
  count: number;
}
interface WeeklyProgressItem {
  week: string;
  newJoiners: number;
  completions: number;
  avgScore: number;
}
interface DashboardStatsType {
  totalTrainees: number;
  activeTrainees: number;
  completedPhase1: number;
  avgScore: number;
  phaseDistribution: PhaseDistributionItem[];
  weeklyProgress: WeeklyProgressItem[];
}

// Add new types for batch progress
interface BatchWeeklyProgress {
  batchId: string;
  batchName: string;
  phase: number;
  weeklyProgress: { week: string; progress: number }[];
}

// Activity type and icon map
const activityTypeMap: Record<string, { icon: JSX.Element; color: string }> = {
  phase_completed: { icon: <CheckCircle className="h-6 w-6 text-emerald-400" />, color: "bg-emerald-50" },
  trainee_joined: { icon: <Users className="h-6 w-6 text-blue-400" />, color: "bg-blue-50" },
  alert: { icon: <AlertCircle className="h-6 w-6 text-orange-400" />, color: "bg-orange-50" },
  default: { icon: <Clock className="h-6 w-6 text-gray-400" />, color: "bg-gray-50" },
};

interface ActivityType {
  id: string;
  type: string;
  user?: { id?: string; name?: string; avatar?: string };
  message: string;
  details?: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}

const accent = "#FF512F";
const accent2 = "#F09819";
const glass = "bg-white/60 backdrop-blur-md shadow-2xl border border-white/30";
const font = { fontFamily: 'Inter, ui-rounded, system-ui, sans-serif' };

const getAdminName = () => {
  // Try to get admin name from localStorage or use a placeholder
  return localStorage.getItem('admin_name') || 'Admin';
};

const AdminDashboard = () => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [trainees, setTrainees] = useState([]);
  const [activeBatchCount, setActiveBatchCount] = useState(0);
  const adminName = getAdminName();
  const [activeTab, setActiveTab] = useState('overview');
  const [overflowBatch, setOverflowBatch] = useState<OverflowBatch | null>(null);

  // New: Dashboard stats state
  const [dashboardStats, setDashboardStats] = useState<DashboardStatsType | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  // Add new state for batch progress
  const [batchProgress, setBatchProgress] = useState<BatchWeeklyProgress[]>([]);
  const [batchProgressLoading, setBatchProgressLoading] = useState(true);
  const [batchProgressError, setBatchProgressError] = useState<string | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<number | 'all'>('all');

  const [activities, setActivities] = useState<ActivityType[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);
  const [showAllActivities, setShowAllActivities] = useState(false);
  const [allActivities, setAllActivities] = useState<ActivityType[]>([]);
  const [allActivitiesLoading, setAllActivitiesLoading] = useState(false);
  const [allActivitiesError, setAllActivitiesError] = useState<string | null>(null);
  const [allActivitiesOffset, setAllActivitiesOffset] = useState(3);
  const [allActivitiesHasMore, setAllActivitiesHasMore] = useState(true);

  // Add state for filter and search
  const [activityTypeFilter, setActivityTypeFilter] = useState<string>('all');
  const [activitySearch, setActivitySearch] = useState('');

  const [scoreDist, setScoreDist] = useState<{ range: string; count: number }[]>([]);
  const [scoreDistLoading, setScoreDistLoading] = useState(true);
  const [scoreDistError, setScoreDistError] = useState<string | null>(null);
  const [completionTimeline, setCompletionTimeline] = useState<{ month: string; completed: number }[]>([]);
  const [completionTimelineLoading, setCompletionTimelineLoading] = useState(true);
  const [completionTimelineError, setCompletionTimelineError] = useState<string | null>(null);

  const [pendingResumes, setPendingResumes] = useState<{ upload_id: string; filename: string }[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [showExtracted, setShowExtracted] = useState(false);
  const [extractedInfo, setExtractedInfo] = useState<{ name: string; email: string; skills: string[] } | null>(null);
  const [accountCreated, setAccountCreated] = useState(false);
  const [accountInfo, setAccountInfo] = useState<{ empId: string; password: string } | null>(null);

  const [open, setOpen] = useState(false);

  // Add a refresh function for active batches
  const fetchActiveBatchCount = () => {
    fetch("http://localhost:8000/batches")
      .then(res => res.json())
      .then((batches) => {
        const count = Array.isArray(batches)
          ? batches.filter((b: BatchForCount) => b.phase === 1 && !b.is_next_batch).length
          : 0;
        setActiveBatchCount(count);
      });
  };

  useEffect(() => {
    setStatsLoading(true);
    fetch("http://localhost:8000/dashboard/stats")
      .then(res => {
        if (!res.ok) throw new Error("Failed to fetch dashboard stats");
        return res.json();
      })
      .then((data: DashboardStatsType) => {
        setDashboardStats(data);
        setStatsError(null);
      })
      .catch(err => {
        setStatsError(err.message);
        setDashboardStats(null);
      })
      .finally(() => setStatsLoading(false));
  }, []);

  useEffect(() => {
    const fetchTrainees = async () => {
      try {
        const response = await fetch("http://localhost:8000/trainees");
        const data = await response.json();
        setTrainees(data);
      } catch (error) {
        console.error("Failed to fetch trainees:", error);
      }
    };

    fetchTrainees();
  }, []);

  // Replace the useEffect for active batch count
  useEffect(() => {
    fetchActiveBatchCount();
    const interval = setInterval(fetchActiveBatchCount, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Fetch overflow batch (is_next_batch: true)
  useEffect(() => {
    fetch("http://localhost:8000/batches")
      .then(res => res.json())
      .then((batches) => {
        if (Array.isArray(batches)) {
          const overflow = batches.find((b) => (b as BatchForCount).is_next_batch);
          setOverflowBatch(overflow as OverflowBatch || null);
        }
      });
  }, []);

  // Fetch batch-wise weekly progress
  useEffect(() => {
    setBatchProgressLoading(true);
    fetch('http://localhost:8000/batches/weekly-progress')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch batch weekly progress');
        return res.json();
      })
      .then(data => {
        setBatchProgress(data);
        setBatchProgressError(null);
      })
      .catch(err => {
        setBatchProgressError(err.message);
        setBatchProgress([]);
      })
      .finally(() => setBatchProgressLoading(false));
  }, []);

  // Get unique phases for filter dropdown
  const uniquePhases = Array.from(new Set(batchProgress.map(b => b.phase))).sort((a, b) => a - b);

  // Filtered batches by selected phase
  const filteredBatches = selectedPhase === 'all' ? batchProgress : batchProgress.filter(b => b.phase === selectedPhase);

  // Remove hardcoded mock data, use API data instead
  const overallStats = dashboardStats || {
    totalTrainees: 0,
    activeTrainees: 0,
    completedPhase1: 0,
    avgScore: 0
  };

  // Convert API phaseDistribution to chart format
  const phaseDistribution = (dashboardStats?.phaseDistribution || []).map((item: PhaseDistributionItem, idx: number) => ({
    name: `Phase ${item.phase}${item.skill && item.skill !== 'Pending' ? ' - ' + item.skill.charAt(0).toUpperCase() + item.skill.slice(1) : ''}`,
    value: item.count,
    color: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#a78bfa"][idx % 5]
  }));

  // Use API weeklyProgress or fallback to empty
  const weeklyProgress = dashboardStats?.weeklyProgress || [];

  const filteredTrainees = trainees.filter(trainee => 
    trainee.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (trainee.empId && trainee.empId.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  // Fetch top 3 activities, poll every 30s
  useEffect(() => {
    let isMounted = true;
    const fetchActivities = () => {
      setActivitiesLoading(true);
      fetch('http://localhost:8000/activities?limit=3')
        .then(res => res.json())
        .then(data => { if (isMounted) { setActivities(data); setActivitiesError(null); } })
        .catch(err => { if (isMounted) { setActivitiesError(err.message); setActivities([]); } })
        .finally(() => { if (isMounted) setActivitiesLoading(false); });
    };
    fetchActivities();
    const interval = setInterval(fetchActivities, 30000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  // Fetch all activities for modal (pagination)
  const fetchAllActivities = (offset = 3, append = false) => {
    setAllActivitiesLoading(true);
    fetch(`http://localhost:8000/activities?limit=20&offset=${offset}`)
      .then(res => res.json())
      .then(data => {
        setAllActivities(prev => append ? [...prev, ...data] : data);
        setAllActivitiesHasMore(data.length === 20);
        setAllActivitiesError(null);
        setAllActivitiesOffset(offset + 20);
      })
      .catch(err => { setAllActivitiesError(err.message); })
      .finally(() => setAllActivitiesLoading(false));
  };

  // Compute filtered and searched activities for modal
  const filteredSearchedActivities = allActivities.filter(activity => {
    const matchesType = activityTypeFilter === 'all' || activity.type === activityTypeFilter;
    const searchLower = activitySearch.toLowerCase();
    const matchesSearch =
      activity.user?.name?.toLowerCase().includes(searchLower) ||
      activity.message.toLowerCase().includes(searchLower) ||
      (activity.details && activity.details.toLowerCase().includes(searchLower));
    return matchesType && (!activitySearch || matchesSearch);
  });

  // Get all unique activity types for filter dropdown
  const allActivityTypes = Array.from(new Set(allActivities.map(a => a.type)));

  // WebSocket for real-time activities
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let isUnmounted = false;

    function connectWS() {
      ws = new WebSocket('ws://localhost:8000/ws/activities');
      ws.onmessage = (event) => {
        try {
          const newActivity: ActivityType = JSON.parse(event.data);
          setActivities(prev => [newActivity, ...prev.slice(0, 2)]); // keep top 3
          // Show toast for alerts
          if (newActivity.type === 'alert') {
            toast({
              title: `Alert: ${newActivity.user?.name ? newActivity.user.name + ' ' : ''}${newActivity.message}`,
              description: newActivity.details,
              variant: 'destructive',
              duration: 8000,
            });
          }
        } catch { /* intentionally ignore JSON parse errors */ }
      };
      ws.onclose = () => {
        if (!isUnmounted) {
          reconnectTimeout = setTimeout(connectWS, 5000);
        }
      };
      ws.onerror = () => {
        ws?.close();
      };
    }
    connectWS();
    return () => {
      isUnmounted = true;
      ws?.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [toast]);

  // Fetch score distribution
  useEffect(() => {
    let isMounted = true;
    const fetchScoreDist = () => {
      setScoreDistLoading(true);
      fetch('http://localhost:8000/analytics/score-distribution')
        .then(res => res.json())
        .then(data => { if (isMounted) { setScoreDist(data); setScoreDistError(null); } })
        .catch(err => { if (isMounted) { setScoreDistError(err.message); setScoreDist([]); } })
        .finally(() => { if (isMounted) setScoreDistLoading(false); });
    };
    fetchScoreDist();
    const interval = setInterval(fetchScoreDist, 30000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  // Fetch completion timeline
  useEffect(() => {
    let isMounted = true;
    const fetchTimeline = () => {
      setCompletionTimelineLoading(true);
      fetch('http://localhost:8000/analytics/completion-timeline')
        .then(res => res.json())
        .then(data => { if (isMounted) { setCompletionTimeline(data); setCompletionTimelineError(null); } })
        .catch(err => { if (isMounted) { setCompletionTimelineError(err.message); setCompletionTimeline([]); } })
        .finally(() => { if (isMounted) setCompletionTimelineLoading(false); });
    };
    fetchTimeline();
    const interval = setInterval(fetchTimeline, 30000);
    return () => { isMounted = false; clearInterval(interval); };
  }, []);

  // Fetch pending resumes on mount
  useEffect(() => {
    setPendingLoading(true);
    fetch("http://localhost:8000/onboarding/pending-resumes")
      .then(res => res.json())
      .then(data => {
        setPendingResumes(data);
        setPendingError(null);
      })
      .catch(err => {
        setPendingError("Failed to fetch pending resumes");
        setPendingResumes([]);
      })
      .finally(() => setPendingLoading(false));
  }, []);

  const handleApprove = async (upload_id: string) => {
    try {
      const res = await fetch("http://localhost:8000/onboarding/approve-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(upload_id)
      });
      const data = await res.json();
      if (res.ok) {
        setExtractedInfo(data);
        setShowExtracted(true);
        setPendingResumes(pendingResumes.filter(r => r.upload_id !== upload_id));
        toast({ title: "Resume Approved", description: `Extracted info for ${data.name}` });
      } else {
        let errorMsg = data.detail;
        if (!errorMsg && Array.isArray(data)) errorMsg = data.map(e => e.msg).join(', ');
        if (!errorMsg && typeof data === 'object') errorMsg = JSON.stringify(data);
        toast({ variant: "destructive", title: "Approval Failed", description: errorMsg || "Unknown error" });
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Approval Error", description: "Could not connect to server." });
    }
  };

  const handleReject = async (upload_id: string) => {
    try {
      const res = await fetch("http://localhost:8000/onboarding/reject-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_id })
      });
      if (res.ok) {
        setPendingResumes(pendingResumes.filter(r => r.upload_id !== upload_id));
        toast({ title: "Resume Rejected", description: `Resume ${upload_id} deleted from cache.` });
      } else {
        const data = await res.json();
        toast({ variant: "destructive", title: "Rejection Failed", description: data.detail || "Unknown error" });
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Rejection Error", description: "Could not connect to server." });
    }
  };

  const handleCreateAccount = async () => {
    if (!extractedInfo) return;
    try {
      const res = await fetch("http://localhost:8000/onboarding/auto-allocate-and-create-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(extractedInfo)
      });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        setAccountCreated(true);
        setAccountInfo({ empId: data.empId, password: data.password });
        toast({ title: "Account Created", description: `Credentials sent to ${extractedInfo.email}` });
      } else {
        toast({ variant: "destructive", title: "Account Creation Failed", description: data.detail || "Unknown error" });
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Account Creation Error", description: "Could not connect to server." });
    }
  };

  if (statsLoading) {
    return <div className="flex justify-center items-center min-h-screen text-xl font-bold">Loading dashboard statistics...</div>;
  }
  if (statsError) {
    return <div className="flex justify-center items-center min-h-screen text-xl font-bold text-red-500">Error: {statsError}</div>;
  }

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #f8fafc 0%, #fff7f0 100%)" }}>
      {/* Header */}
      <div className={`w-full ${glass} py-4 px-0 mb-8`} style={{ boxShadow: `0 8px 32px 0 ${accent}22` }}>
        <div className="container mx-auto flex justify-between items-center" style={font}>
          <div className="flex items-center gap-4">
            <span className="rounded-full bg-gradient-to-tr from-orange-400 to-orange-500 p-3 shadow-lg">
              <Rocket className="h-7 w-7 text-white" />
            </span>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight" style={{ color: accent, letterSpacing: '-0.04em' }}>Admin Dashboard</h1>
              <p className="text-base text-gray-500 font-medium">Mavericks Training Management Portal</p>
              <p className="text-base mt-1 font-semibold" style={{ color: accent2 }}>Welcome, {adminName}!</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Popover.Root open={open} onOpenChange={setOpen}>
              <Popover.Trigger asChild>
                <button
                  className="rounded-full p-2 bg-white/80 hover:bg-orange-50 shadow border border-orange-100 transition-all relative"
                  aria-label="Notifications"
                >
                  <Bell className="h-6 w-6 text-orange-400" />
                  {pendingResumes.length > 0 && (
                    <span className="absolute top-0 right-0 block h-3 w-3 rounded-full bg-red-500 border-2 border-white"></span>
                  )}
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <AnimatePresence>
                  {open && (
                    <Popover.Content side="bottom" align="end" sideOffset={8} asChild>
                      <motion.div
                        initial={{ opacity: 0, scale: 0.7, y: -20 }}
                        animate={{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 400, damping: 30 } }}
                        exit={{ opacity: 0, scale: 0.7, y: -20, transition: { duration: 0.2 } }}
                        className="rounded-2xl bg-white/20 shadow-2xl border border-white/40 p-6 min-w-[320px] max-w-xs"
                        style={{ backdropFilter: 'blur(16px)' }}
                      >
                        <div className="font-bold text-lg text-orange-500 mb-2">Notifications</div>
                        <div className="text-base text-gray-700">
                          {pendingResumes.length > 0 ? (
                            <>
                              A trainee submitted resume needs to be approved for batch allocation.<br />
                              <b>Check onboarding section.</b>
                            </>
                          ) : (
                            <span>No notifications.</span>
                          )}
                        </div>
                      </motion.div>
                    </Popover.Content>
                  )}
                </AnimatePresence>
              </Popover.Portal>
            </Popover.Root>
            <Button
              className="rounded-full px-6 py-2 text-base font-semibold shadow-md bg-gradient-to-r from-orange-500 to-orange-400 hover:from-orange-600 hover:to-orange-500 text-white flex items-center gap-2 transition-all duration-200"
              onClick={() => {
                localStorage.removeItem('empId');
                localStorage.removeItem('is_admin');
                localStorage.removeItem('admin_name');
                navigate('/');
              }} style={font}
            >
              <LogOut className="h-5 w-5" /> Logout
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-6">
        {/* Quick Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          <div className={`rounded-3xl ${glass} p-6 flex flex-col items-center transition-transform hover:scale-105`} style={{ boxShadow: `0 8px 32px 0 #3b82f622` }}>
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-7 w-7 text-orange-400" />
              <span className="text-lg font-semibold text-orange-500">Total Trainees</span>
            </div>
            <span className="text-3xl font-extrabold mt-2" style={{ color: accent }}>{overallStats.totalTrainees}</span>
          </div>
          <div className={`rounded-3xl ${glass} p-6 flex flex-col items-center transition-transform hover:scale-105 cursor-pointer`} style={{ boxShadow: `0 8px 32px 0 #10b98122` }} onClick={() => navigate('/admin/batches')}>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="h-7 w-7 text-emerald-400" />
              <span className="text-lg font-semibold text-emerald-500">Active Batches</span>
            </div>
            <span className="text-3xl font-extrabold mt-2 text-emerald-600">{activeBatchCount}</span>
            <span className="text-xs text-gray-500 mt-1">Phase 1 Underway</span>
          </div>
          <div className={`rounded-3xl ${glass} p-6 flex flex-col items-center transition-transform hover:scale-105 cursor-pointer`} style={{ boxShadow: `0 8px 32px 0 #a78bfa22` }} onClick={() => navigate('/admin/next-batch')}>
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="h-7 w-7 text-orange-400" />
              <span className="text-lg font-semibold text-orange-500">Next Batch (Overflow)</span>
            </div>
            <span className="text-base text-gray-500 mb-2">Trainees: {overflowBatch ? overflowBatch.trainees.length : 0}</span>
          </div>
          <div className={`rounded-3xl ${glass} p-6 flex flex-col items-center transition-transform hover:scale-105`} style={{ boxShadow: `0 8px 32px 0 #f59e0b22` }}>
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="h-7 w-7 text-orange-400" />
              <span className="text-lg font-semibold text-orange-500">Average Score</span>
            </div>
            <span className="text-3xl font-extrabold mt-2" style={{ color: accent2 }}>{overallStats.avgScore}%</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex justify-center mb-10">
          <div className="flex gap-4 bg-white/60 backdrop-blur-md rounded-full shadow-lg p-2 border border-orange-100" style={{ fontFamily: 'Inter, ui-rounded, system-ui, sans-serif' }}>
            {['overview', 'trainees', 'analytics', 'reports', 'onboarding'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-7 py-2 rounded-full font-semibold text-lg transition-all duration-200 shadow-sm border-2 ${activeTab === tab ? 'bg-gradient-to-r from-orange-500 to-orange-400 text-white border-orange-400 scale-105' : 'bg-white/80 text-orange-500 border-orange-200 hover:bg-orange-50 hover:scale-105'}`}
                style={{ minWidth: 120 }}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {/* Tab Content with fade/slide transition */}
        <div className="transition-all duration-500 ease-in-out animate-fadein">
          {activeTab === 'overview' && (
            <>
              {/* Overview Section (analytics, charts, activities) */}
              <div className="grid lg:grid-cols-2 gap-10 mb-12">
                {/* Weekly Progress Chart */}
                <div className={`rounded-3xl ${glass} p-8 shadow-xl`} style={{ boxShadow: `0 8px 32px 0 ${accent}22` }}>
                  <div className="flex items-center gap-3 mb-4">
                    <BarChart3 className="h-7 w-7 text-orange-400" />
                    <span className="text-xl font-bold text-orange-500">Weekly Training Progress</span>
                  </div>
                  <div className="w-full h-64 flex items-center justify-center">
                    {weeklyProgress.length === 0 ? (
                      <span className="text-gray-400 text-lg font-semibold">No data available</span>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={weeklyProgress}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="week" />
                          <YAxis />
                          <Tooltip />
                          <Line type="monotone" dataKey="newJoiners" stroke="#FF512F" strokeWidth={3} name="New Joiners" />
                          <Line type="monotone" dataKey="completions" stroke="#14B8A6" strokeWidth={3} name="Completions" />
                          <Line type="monotone" dataKey="avgScore" stroke="#F09819" strokeWidth={3} name="Avg Score" />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
                {/* Phase Distribution Pie Chart */}
                <div className={`rounded-3xl ${glass} p-8 shadow-xl`} style={{ boxShadow: `0 8px 32px 0 #a78bfa22` }}>
                  <div className="flex items-center gap-3 mb-4">
                    <Brain className="h-7 w-7 text-purple-400" />
                    <span className="text-xl font-bold text-purple-500">Training Phase Distribution</span>
                  </div>
                  <div className="w-full h-64 flex items-center justify-center">
                    {phaseDistribution.length === 0 ? (
                      <span className="text-gray-400 text-lg font-semibold">No data available</span>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={phaseDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={60} fill="#8884d8" label>
                            {phaseDistribution.map((entry, idx) => (
                              <Cell key={`cell-${idx}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>
              {/* Recent Activities Section */}
              <div className="rounded-3xl bg-white/80 shadow-xl p-8 mb-12">
                <div className="flex items-center gap-3 mb-4">
                  <Clock className="h-7 w-7 text-orange-400" />
                  <span className="text-2xl font-bold text-orange-500">Recent Activities</span>
                </div>
                {activitiesLoading ? (
                  <div className="text-lg text-gray-400">Loading...</div>
                ) : activitiesError ? (
                  <div className="text-lg text-red-500">Error: {activitiesError}</div>
                ) : activities.length === 0 ? (
                  <div className="text-lg text-gray-400">No recent activities</div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {activities.map((activity, idx) => {
                      const typeInfo = activityTypeMap[activity.type] || activityTypeMap.default;
                      return (
                        <div key={activity.id} className={`flex items-center justify-between rounded-xl px-6 py-4 ${typeInfo.color}`}>
                          <div className="flex items-center gap-4">
                            {typeInfo.icon}
                            <div>
                              <div className={`font-semibold ${activity.type === 'alert' ? 'text-orange-600' : activity.type === 'phase_completed' ? 'text-emerald-700' : activity.type === 'trainee_joined' ? 'text-blue-700' : 'text-gray-700'}`}>{activity.user?.name ? <span>{activity.user.name} </span> : null}{activity.message}</div>
                              {activity.details && <div className="text-gray-500 text-sm mt-1">{activity.details}</div>}
                            </div>
                          </div>
                          <div className="text-gray-400 text-sm ml-4 whitespace-nowrap">{formatTimeAgo(activity.timestamp)}</div>
                        </div>
                      );
                    })}
                    <button
                      className="mt-4 px-6 py-2 rounded-full bg-gradient-to-r from-orange-500 to-orange-400 text-white font-semibold shadow hover:from-orange-600 hover:to-orange-500 transition-all"
                      onClick={() => { setShowAllActivities(true); fetchAllActivities(); }}
                    >
                      More Activities
                    </button>
                  </div>
                )}
                {/* Modal for all activities */}
                <Dialog open={showAllActivities} onOpenChange={setShowAllActivities}>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>All Activities</DialogTitle>
                      <DialogClose asChild>
                        <button className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">&times;</button>
                      </DialogClose>
                    </DialogHeader>
                    <div className="flex gap-4 mb-4">
                      <select
                        className="px-3 py-2 rounded border border-orange-200 bg-white text-orange-600 font-semibold"
                        value={activityTypeFilter}
                        onChange={e => setActivityTypeFilter(e.target.value)}
                      >
                        <option value="all">All Types</option>
                        {allActivityTypes.map(type => (
                          <option key={type} value={type}>{type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>
                        ))}
                      </select>
                      <input
                        className="flex-1 px-3 py-2 rounded border border-orange-200 bg-white text-gray-700"
                        placeholder="Search by user or message..."
                        value={activitySearch}
                        onChange={e => setActivitySearch(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
                      {allActivitiesLoading && <div className="text-lg text-gray-400">Loading...</div>}
                      {allActivitiesError && <div className="text-lg text-red-500">Error: {allActivitiesError}</div>}
                      {filteredSearchedActivities.length === 0 && !allActivitiesLoading ? <div className="text-lg text-gray-400">No activities found</div> : null}
                      {filteredSearchedActivities.map((activity, idx) => {
                        const typeInfo = activityTypeMap[activity.type] || activityTypeMap.default;
                        return (
                          <div key={activity.id} className={`flex items-center justify-between rounded-xl px-6 py-4 ${typeInfo.color}`}>
                            <div className="flex items-center gap-4">
                              {/* Avatar if available */}
                              {activity.user?.avatar ? (
                                <img src={activity.user.avatar} alt={activity.user.name || 'User'} className="h-8 w-8 rounded-full object-cover border border-gray-200" />
                              ) : (
                                <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 font-bold">
                                  {activity.user?.name ? activity.user.name.charAt(0).toUpperCase() : <Users className="h-5 w-5" />}
                                </div>
                              )}
                              {typeInfo.icon}
                              <div>
                                <div className={`font-semibold ${activity.type === 'alert' ? 'text-orange-600' : activity.type === 'phase_completed' ? 'text-emerald-700' : activity.type === 'trainee_joined' ? 'text-blue-700' : 'text-gray-700'}`}>{activity.user?.name ? <span>{activity.user.name} </span> : null}{activity.message}</div>
                                {activity.details && <div className="text-gray-500 text-sm mt-1">{activity.details}</div>}
                              </div>
                            </div>
                            <div className="text-gray-400 text-sm ml-4 whitespace-nowrap">{formatTimeAgo(activity.timestamp)}</div>
                          </div>
                        );
                      })}
                      {allActivitiesHasMore && !allActivitiesLoading && (
                        <button
                          className="mt-4 px-6 py-2 rounded-full bg-gradient-to-r from-orange-500 to-orange-400 text-white font-semibold shadow hover:from-orange-600 hover:to-orange-500 transition-all"
                          onClick={() => fetchAllActivities(allActivitiesOffset, true)}
                        >
                          Load More
                        </button>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </>
          )}
          {activeTab === 'trainees' && (
            <div>
              <div className="relative mb-6 max-w-xl mx-auto">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  type="search"
                  placeholder="Search trainees by name or employee ID..."
                  className="pl-10 w-full rounded-full bg-white/70 shadow-md border border-orange-100 focus:ring-2 focus:ring-orange-300"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                {filteredTrainees.map((trainee) => (
                  <Link to={`/trainee-dashboard/${trainee.empId}`} key={trainee.empId} className="block text-inherit no-underline">
                    <div className={`rounded-3xl ${glass} p-6 hover:scale-105 transition-transform flex flex-col h-full shadow-xl`}>
                      <div className="flex items-center gap-4 border-b pb-4 mb-4">
                        <Avatar className="h-14 w-14">
                          <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${trainee.name}`} />
                          <AvatarFallback>{trainee.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                        </Avatar>
                        <div>
                          <h3 className="font-semibold text-lg">{trainee.name}</h3>
                          <p className="text-sm text-gray-600">{trainee.empId}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm mb-2">
                        <div>
                          <p className="text-gray-500">Phase</p>
                          <Badge variant={trainee.phase === 2 ? "default" : "secondary"}>
                            Phase {trainee.phase}
                          </Badge>
                        </div>
                        <div>
                          <p className="text-gray-500">Status</p>
                          <Badge variant={trainee.status === 'active' ? 'default' : 'destructive'}>{trainee.status}</Badge>
                        </div>
                        <div className="col-span-2">
                          <p className="text-gray-500">Progress</p>
                          <div className="flex items-center gap-2">
                            <Progress value={trainee.progress} className="w-full" />
                            <p className="font-semibold">{trainee.progress}%</p>
                          </div>
                        </div>
                        <div className="col-span-2">
                          <p className="text-gray-500">Score</p>
                          <p className="font-semibold text-green-600">{trainee.score}%</p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-gray-500">Specialization</p>
                          <Badge variant="outline">{trainee.specialization}</Badge>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {activeTab === 'analytics' && (
            <div className="space-y-10">
              {/* AI Insights */}
              <div className={`rounded-3xl ${glass} p-8 shadow-xl mb-8`} style={{ boxShadow: `0 8px 32px 0 #3b82f622` }}>
                <div className="flex items-center gap-3 mb-4">
                  <Brain className="h-7 w-7 text-blue-400" />
                  <span className="text-xl font-bold text-blue-500">AI-Generated Insights</span>
                </div>
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h3 className="font-semibold text-blue-900 mb-3">Performance Trends</h3>
                      <div className="space-y-2 text-blue-800">
                        <p>• Average completion time: 6.2 weeks (improving)</p>
                        <p>• High performers: 34% (Python track preference)</p>
                        <p>• At-risk trainees: 8% (need intervention)</p>
                        <p>• Most challenging topic: Database Design</p>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-semibold text-blue-900 mb-3">Recommendations</h3>
                      <div className="space-y-2 text-blue-800">
                        <p>• Increase database training duration by 20%</p>
                        <p>• Add peer mentoring for struggling students</p>
                        <p>• Create advanced Python track for top performers</p>
                        <p>• Schedule mid-phase check-ins</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {/* Performance Analytics */}
              <div className="grid lg:grid-cols-2 gap-10">
                {/* Score Distribution */}
                <div className={`rounded-3xl ${glass} p-8 shadow-xl`}>
                  <div className="text-lg font-semibold mb-4">Score Distribution</div>
                  {scoreDistLoading ? (
                    <div className="text-gray-400">Loading...</div>
                  ) : scoreDistError ? (
                    <div className="text-red-500">Error: {scoreDistError}</div>
                  ) : scoreDist.length === 0 ? (
                    <div className="text-gray-400">No data available</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={scoreDist} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" />
                        <YAxis dataKey="range" type="category" />
                        <Tooltip formatter={(value: number) => [`${value} trainees`, 'Count']} />
                        <Bar dataKey="count" fill="#3b82f6" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
                {/* Completion Timeline */}
                <div className={`rounded-3xl ${glass} p-8 shadow-xl`}>
                  <div className="text-lg font-semibold mb-4">Completion Timeline</div>
                  {completionTimelineLoading ? (
                    <div className="text-gray-400">Loading...</div>
                  ) : completionTimelineError ? (
                    <div className="text-red-500">Error: {completionTimelineError}</div>
                  ) : completionTimeline.length === 0 ? (
                    <div className="text-gray-400">No data available</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={250}>
                      <LineChart data={completionTimeline}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" />
                        <YAxis />
                        <Tooltip formatter={(value: number) => [`${value} completions`, 'Completed']} />
                        <Line type="monotone" dataKey="completed" stroke="#10b981" strokeWidth={3} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          )}
          {activeTab === 'reports' && (
            <div className="space-y-10">
              <div className={`rounded-3xl ${glass} p-8 shadow-xl`}>
                <div className="flex items-center gap-3 mb-4">
                  <Download className="h-7 w-7 text-orange-400" />
                  <span className="text-xl font-bold text-orange-500">Generate Reports</span>
                </div>
                <div className="grid md:grid-cols-2 gap-8">
                  <div className="rounded-2xl bg-white/70 p-6 shadow border border-orange-100">
                    <h3 className="font-semibold mb-2">Overall Training Statistics</h3>
                    <p className="text-sm text-gray-600 mb-4">Complete overview of all training programs and participant progress</p>
                    <Button className="w-full bg-gradient-to-r from-orange-500 to-orange-400 text-white">
                      <Download className="h-4 w-4 mr-2" />
                      Download Full Report
                    </Button>
                  </div>
                  <div className="rounded-2xl bg-white/70 p-6 shadow border border-orange-100">
                    <h3 className="font-semibold mb-2">Individual Progress Reports</h3>
                    <p className="text-sm text-gray-600 mb-4">Detailed reports for each trainee including scores and recommendations</p>
                    <Button className="w-full bg-gradient-to-r from-orange-500 to-orange-400 text-white" variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Generate Individual Reports
                    </Button>
                  </div>
                  <div className="rounded-2xl bg-white/70 p-6 shadow border border-orange-100">
                    <h3 className="font-semibold mb-2">AI Analytics Summary</h3>
                    <p className="text-sm text-gray-600 mb-4">AI-generated insights and performance predictions</p>
                    <Button className="w-full bg-gradient-to-r from-orange-500 to-orange-400 text-white" variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Download AI Report
                    </Button>
                  </div>
                  <div className="rounded-2xl bg-white/70 p-6 shadow border border-orange-100">
                    <h3 className="font-semibold mb-2">Monthly Summary</h3>
                    <p className="text-sm text-gray-600 mb-4">Monthly training progress and completion statistics</p>
                    <Button className="w-full bg-gradient-to-r from-orange-500 to-orange-400 text-white" variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Download Monthly Report
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'onboarding' && (
            <div className="mt-10">
              <MentorOnboarding />
              <TraineeOnboarding />
              {/* Pending Resume Approvals section styled to match Batch Trainee Onboarding */}
              <div className="rounded-3xl bg-white/70 backdrop-blur-md shadow-2xl border border-white/30 p-8 mt-10">
                <h2 className="text-2xl font-bold text-orange-500 mb-2 flex items-center gap-2">
                  <span className="inline-block rounded-full bg-orange-100 p-2"><Users className="h-7 w-7 text-orange-400" /></span>
                  Pending Resume Approvals
                </h2>
                <p className="text-gray-500 mb-6 text-base">Review and approve or reject resumes submitted by trainees for onboarding.</p>
                {pendingLoading ? (
                  <div>Loading pending resumes...</div>
                ) : pendingError ? (
                  <div className="text-red-500">{pendingError}</div>
                ) : pendingResumes.length === 0 ? (
                  <div>No pending resumes for approval.</div>
                ) : (
                  <div className="space-y-4">
                    {pendingResumes.map(r => (
                      <div key={r.upload_id} className="flex items-center gap-4 p-4 bg-orange-50 rounded-xl shadow">
                        <div className="flex-1">
                          <div className="font-semibold">{r.filename}</div>
                          <div className="text-xs text-gray-500">ID: {r.upload_id}</div>
                        </div>
                        <Button
                          variant="default"
                          onClick={() => handleApprove(r.upload_id)}
                          className="rounded-full bg-gradient-to-r from-orange-500 to-orange-400 text-white px-6 py-2 font-semibold shadow-md hover:from-orange-600 hover:to-orange-500 transition-colors"
                        >
                          Approve
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => handleReject(r.upload_id)}
                          className="rounded-full font-semibold shadow-md px-6 py-2 ml-2"
                        >
                          Reject
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
                {/* Dialog for extracted info */}
                {showExtracted && extractedInfo && (
                  <Dialog open={showExtracted} onOpenChange={setShowExtracted}>
                    <DialogContent className="rounded-3xl bg-white/70 backdrop-blur-2xl shadow-2xl border border-white/40 p-10 max-w-md">
                      <DialogHeader>
                        <DialogTitle className="text-2xl font-bold text-orange-500 mb-4 drop-shadow-sm">Extracted Resume Info</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-2 text-base text-gray-800">
                        <div><span className="font-semibold">Name:</span> {extractedInfo.name}</div>
                        <div><span className="font-semibold">Email:</span> {extractedInfo.email}</div>
                        <div><span className="font-semibold">Skills:</span> {extractedInfo.skills.join(", ")}</div>
                        {accountCreated && accountInfo ? (
                          <div className="mt-4 p-3 bg-green-50/80 rounded-xl shadow-sm">
                            <div className="font-semibold text-green-700">Account Created!</div>
                            <div>Employee ID: <b>{accountInfo.empId}</b></div>
                            <div>Temporary Password: <b>{accountInfo.password}</b></div>
                          </div>
                        ) : (
                          <Button
                            className="mt-6 w-full rounded-full bg-gradient-to-r from-orange-500 to-orange-400 text-white font-semibold shadow-lg hover:from-orange-600 hover:to-orange-500 transition-colors"
                            onClick={handleCreateAccount}
                          >
                            Create Account
                          </Button>
                        )}
                      </div>
                      <DialogClose asChild>
                        <Button
                          variant="outline"
                          className="mt-3 w-full rounded-full font-semibold border-white/40 text-orange-500 bg-white/80 backdrop-blur hover:bg-orange-50/80"
                          onClick={() => { setShowExtracted(false); setAccountCreated(false); setAccountInfo(null); }}
                        >
                          Close
                        </Button>
                      </DialogClose>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Helper to format time ago
function formatTimeAgo(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return `${diff} seconds ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  return date.toLocaleDateString();
}

export default AdminDashboard;
