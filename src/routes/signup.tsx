import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { AuthShell } from "./login";
import { signIn } from "@/lib/auth";

export const Route = createFileRoute("/signup")({ component: SignupPage });

function SignupPage() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error, data } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { display_name: name },
      },
    });

    if (error) {
      toast.error(error.message);
      setBusy(false);
      return;
    }

    if (data.session) {
      try {
        await signIn({
          data: {
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
          }
        });
        toast.success("Account created");
        nav({ to: "/dashboard" });
      } catch (err) {
        console.error("Failed to sync session to server:", err);
        toast.error("Signup successful, but session sync failed. Please log in.");
        nav({ to: "/login" });
      }
    } else {
      toast.success("Check your email to confirm your account");
    }
    setBusy(false);
  };

  return (
    <AuthShell title="Create your account" subtitle="Start monitoring your wash sites">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" minLength={8} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy} className="w-full shadow-glow">
          {busy ? "Creating…" : "Create account"}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground mt-4 text-center">
        Already have an account? <Link to="/login" className="text-primary hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
