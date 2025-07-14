import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";

const glass = "bg-white/60 backdrop-blur-md shadow-2xl border border-white/30";
const font = { fontFamily: 'Inter, ui-rounded, system-ui, sans-serif' };

export default function MentorOnboarding() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [created, setCreated] = useState<{ empId: string; password: string } | null>(null);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setCreated(null);
    try {
      const res = await fetch("http://localhost:8000/onboarding/create-mentor-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, specialization }),
      });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        setCreated({ empId: data.empId, password: data.password });
        toast({ title: "Mentor Created", description: `Credentials sent to ${email}` });
        setName(""); setEmail(""); setSpecialization("");
      } else {
        toast({ variant: "destructive", title: "Creation Failed", description: data.message || data.detail || "Unknown error" });
      }
    } catch (err) {
      toast({ variant: "destructive", title: "Error", description: "Could not connect to backend." });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`rounded-3xl ${glass} p-8 shadow-xl mb-8`} style={{ boxShadow: `0 8px 32px 0 #FF512F22` }}>
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-orange-500">Mentor Onboarding</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div>
            <Label htmlFor="mentor-name">Name</Label>
            <Input id="mentor-name" value={name} onChange={e => setName(e.target.value)} required style={font} />
          </div>
          <div>
            <Label htmlFor="mentor-email">Email</Label>
            <Input id="mentor-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required style={font} />
          </div>
          <div>
            <Label htmlFor="mentor-specialization">Specialization</Label>
            <Input id="mentor-specialization" value={specialization} onChange={e => setSpecialization(e.target.value)} placeholder="e.g. Java, Data Science" style={font} />
          </div>
          <Button type="submit" className="w-full rounded-full bg-gradient-to-r from-orange-500 to-orange-400 text-white font-semibold shadow-lg hover:from-orange-600 hover:to-orange-500 transition-colors" disabled={isLoading}>
            {isLoading ? "Creating..." : "Create Mentor Account"}
          </Button>
        </form>
        {created && (
          <div className="mt-6 p-4 bg-green-50/80 rounded-xl shadow-sm">
            <div className="font-semibold text-green-700">Mentor Account Created!</div>
            <div>Employee ID: <b>{created.empId}</b></div>
            <div>Temporary Password: <b>{created.password}</b></div>
            <div className="text-gray-500 text-sm mt-2">Credentials have also been sent to the mentor's email.</div>
          </div>
        )}
      </CardContent>
    </div>
  );
} 