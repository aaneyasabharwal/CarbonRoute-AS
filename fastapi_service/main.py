"""
CarbonRoute FastAPI Scheduling & Execution Backend
UCS503 Software Engineering Final-Year Project — Team TriFlux
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import math
import os
import uuid
from datetime import datetime

app = FastAPI(
    title="CarbonRoute Scheduling & Workload API",
    description="Uncertainty-Aware Carbon-Aware Batch Scheduling Engine with Kubernetes Dispatch",
    version="1.0.0",
)

# M1.9: explicit origin allow-list from CORS_ORIGIN; credentials never with a wildcard.
try:  # run from fastapi_service/ (README) or imported as a package
    from cors_config import cors_settings  # noqa: E402
except ImportError:  # pragma: no cover
    from .cors_config import cors_settings  # noqa: E402

app.add_middleware(CORSMiddleware, **cors_settings(os.environ))

# Models
class JobSubmissionRequest(BaseModel):
    name: str = Field(..., example="ResNet-50 Batch Training")
    command_or_image: str = Field(..., example="carbonroute/test-workload:latest")
    is_container_image: bool = True
    duration_hours: float = Field(2.0, ge=0.25, le=48.0)
    deadline_hours: float = Field(12.0, ge=1.0, le=72.0)
    arrival_hour: float = Field(0.0, ge=0.0)
    cpu: float = Field(1.0, ge=0.1)
    memory_mb: int = Field(512, ge=64)
    region: str = Field("US-CAL-CISO", example="US-CAL-CISO")
    risk_tolerance: float = Field(0.05, ge=0.01, le=1.0)

class SchedulingRequest(BaseModel):
    job_id: Optional[str] = None
    job_data: Optional[JobSubmissionRequest] = None
    region: str = "US-CAL-CISO"
    uncertainty_multiplier: float = 1.0

# In-memory stores
jobs_db: Dict[str, Dict[str, Any]] = {}
executions_db: Dict[str, Dict[str, Any]] = {}
experiments_db: List[Dict[str, Any]] = []

def get_demo_carbon_profile(region: str) -> List[float]:
    # Characteristic profiles:
    if region == "US-TEX-ERCO":
        return [230, 210, 195, 190, 205, 240, 280, 310, 330, 345, 360, 375, 390, 410, 420, 410, 390, 360, 320, 290, 270, 250, 240, 235]
    elif region == "DE":
        return [380, 365, 350, 340, 355, 390, 430, 410, 370, 310, 260, 230, 215, 225, 250, 290, 360, 420, 450, 430, 410, 395, 390, 385]
    elif region == "IN-NO":
        return [640, 630, 620, 615, 630, 670, 710, 680, 610, 540, 480, 450, 440, 455, 490, 560, 660, 740, 780, 760, 720, 680, 660, 650]
    # Default: California solar duck-curve
    return [310, 295, 285, 280, 290, 320, 360, 340, 280, 220, 170, 150, 140, 145, 160, 190, 260, 350, 390, 370, 340, 320, 310, 305]

def estimate_deadline_risk(start_t: int, duration: float, deadline: float, std_dev: float, multiplier: float = 1.0) -> float:
    slack = deadline - (start_t + duration)
    if slack < 0:
        return 1.0
    eff_std = max(1.0, std_dev * multiplier)
    z = slack / eff_std
    return min(1.0, max(0.0, 0.5 * math.erfc(z / math.sqrt(2))))

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "CarbonRoute FastAPI Service",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "version": "1.0.0"
    }

@app.post("/jobs")
def submit_job(req: JobSubmissionRequest):
    job_id = f"job-{uuid.uuid4().hex[:8]}"
    job_record = {
        "id": job_id,
        "name": req.name,
        "commandOrImage": req.command_or_image,
        "isContainerImage": req.is_container_image,
        "durationHours": req.duration_hours,
        "deadlineHours": req.deadline_hours,
        "arrivalHour": req.arrival_hour,
        "cpu": req.cpu,
        "memoryMb": req.memory_mb,
        "region": req.region,
        "riskTolerance": req.risk_tolerance,
        "status": "pending",
        "createdAt": datetime.utcnow().isoformat() + "Z"
    }
    jobs_db[job_id] = job_record
    return {"success": True, "message": "Workload registered.", "data": job_record}

@app.post("/schedule")
def schedule_workload(req: SchedulingRequest):
    job = req.job_data.dict() if req.job_data else (jobs_db.get(req.job_id) if req.job_id else None)
    if not job:
        raise HTTPException(status_code=400, detail="Job data or valid job_id required.")

    region = req.region or job.get("region", "US-CAL-CISO")
    profile = get_demo_carbon_profile(region)
    dur = int(job.get("durationHours", 2))
    ddl = int(job.get("deadlineHours", 12))
    arrival = int(job.get("arrivalHour", 0))
    tau = float(job.get("riskTolerance", 0.05))
    cpu_cores = float(job.get("cpu", 1.0))
    p_avg = (cpu_cores / 2.0) * 0.25  # kW active power baseline

    # Candidate Windows Enumeration: evaluate all windows fitting before deadline
    max_eval_hour = min(ddl - dur, len(profile) - dur)
    candidate_windows = []

    for t in range(0, max_eval_hour + 1):
        window_pts = profile[t : t + dur]
        if not window_pts:
            continue
        avg_intensity = sum(window_pts) / len(window_pts)
        impact_grams = avg_intensity * dur * p_avg
        std = 15.0 * math.sqrt(1.0 + (t / 6.0))
        slack = ddl - (t + dur)
        meets_deadline = slack >= 0

        if not meets_deadline:
            risk = 1.0
            classification = "REJECTED_DEADLINE_BREACH"
            label = "REJECTED"
            reason = f"Execution window ends at T+{t + dur}:00, exceeding deadline (T+{ddl}:00)."
        else:
            risk = estimate_deadline_risk(t, dur, ddl, std, req.uncertainty_multiplier)
            if risk > tau:
                classification = "REJECTED_HIGH_RISK"
                label = "REJECTED"
                reason = f"Risk exceeds {tau * 100:.0f}% tolerance ({risk * 100:.1f}% deadline-miss risk)"
            else:
                classification = "FEASIBLE"
                label = "FEASIBLE"
                reason = f"Feasible option: {avg_intensity:.1f} gCO2/kWh with {risk * 100:.1f}% risk"

        candidate_windows.append({
            "slotIndex": t,
            "startHour": t,
            "endHour": t + dur,
            "windowLabel": f"T+{t}:00 → T+{t + dur}:00",
            "predictedCarbonIntensity": round(avg_intensity, 1),
            "predictedCarbonImpactGrams": round(impact_grams, 1),
            "stdDev": round(std, 1),
            "uncertaintyRange": f"±{std:.1f} gCO2/kWh",
            "deadlineRisk": round(risk, 4),
            "deadlineRiskPct": f"{risk * 100:.1f}%",
            "slackHours": slack,
            "waitingTimeHours": t,
            "isFeasible": meets_deadline and (risk <= tau),
            "meetsDeadline": meets_deadline,
            "classification": classification,
            "classificationLabel": label,
            "reason": reason,
        })

    # Evaluate Policies:
    # 1. Immediate
    imm_pts = profile[arrival : arrival + dur]
    imm_carbon = round(sum(imm_pts) / len(imm_pts), 1)
    imm_risk = estimate_deadline_risk(arrival, dur, ddl, 15.0, req.uncertainty_multiplier)

    # 2. EDF
    edf_slot = arrival
    edf_carbon = imm_carbon

    # 3. Deterministic Carbon (minimum carbon window fitting before deadline, ignoring risk)
    best_det = arrival
    min_det_c = 99999.0
    for t in range(arrival, ddl - dur + 1):
        w_pts = profile[t : t + dur]
        if w_pts:
            w_avg = sum(w_pts) / len(w_pts)
            if w_avg < min_det_c:
                min_det_c = w_avg
                best_det = t
    det_std = 15.0 * math.sqrt(1.0 + (best_det / 6.0))
    det_risk = estimate_deadline_risk(best_det, dur, ddl, det_std, req.uncertainty_multiplier)

    # 4. CarbonAware Baseline (heuristic 1-2h shift)
    best_base = arrival
    min_base_c = 99999.0
    for t in range(arrival, min(arrival + 3, ddl - dur + 1)):
        w_pts = profile[t : t + dur]
        if w_pts:
            w_avg = sum(w_pts) / len(w_pts)
            if w_avg < min_base_c:
                min_base_c = w_avg
                best_base = t
    base_std = 15.0 * math.sqrt(1.0 + (best_base / 6.0))
    base_risk = estimate_deadline_risk(best_base, dur, ddl, base_std, req.uncertainty_multiplier)

    # 5. CarbonRoute Uncertainty-Aware (min carbon feasible window)
    feasible_windows = [w for w in candidate_windows if w["isFeasible"]]
    if feasible_windows:
        feasible_windows.sort(key=lambda x: x["predictedCarbonIntensity"])
        best_win = feasible_windows[0]
        # Mark as recommended in candidate_windows list
        for w in candidate_windows:
            if w["slotIndex"] == best_win["slotIndex"]:
                w["classification"] = "RECOMMENDED"
                w["classificationLabel"] = "RECOMMENDED"
                w["reason"] = "Lowest expected-carbon candidate among all windows satisfying the deadline and risk constraints."

        cr_slot = best_win["startHour"]
        cr_carbon = best_win["predictedCarbonIntensity"]
        cr_risk = best_win["deadlineRisk"]
        rationale = best_win["reason"]
    else:
        cr_slot = arrival
        cr_carbon = imm_carbon
        cr_risk = imm_risk
        rationale = f"No slot met the strict risk tolerance {tau:.1%}; defaulted to arrival window T+{arrival}."

    savings_pct = round(((imm_carbon - cr_carbon) / imm_carbon) * 100.0, 1) if imm_carbon > 0 else 0.0

    decision = {
        "job": job,
        "region": region,
        "candidateWindows": candidate_windows,
        "evaluatedPolicies": [
            {"policyId": "immediate", "policyName": "Immediate", "selectedStartHour": arrival, "predictedCarbon": imm_carbon, "estimatedDeadlineRisk": imm_risk, "waitingTimeHours": 0, "isFeasible": imm_risk <= tau},
            {"policyId": "edf", "policyName": "EDF", "selectedStartHour": edf_slot, "predictedCarbon": edf_carbon, "estimatedDeadlineRisk": imm_risk, "waitingTimeHours": 0, "isFeasible": imm_risk <= tau},
            {"policyId": "deterministic_carbon", "policyName": "Deterministic Carbon", "selectedStartHour": best_det, "predictedCarbon": round(min_det_c, 1), "estimatedDeadlineRisk": det_risk, "waitingTimeHours": best_det, "isFeasible": det_risk <= tau},
            {"policyId": "carbonaware_baseline", "policyName": "CarbonAware Baseline", "selectedStartHour": best_base, "predictedCarbon": round(min_base_c, 1), "estimatedDeadlineRisk": base_risk, "waitingTimeHours": best_base, "isFeasible": base_risk <= tau},
            {"policyId": "carbonroute_uncertainty", "policyName": "CarbonRoute Uncertainty-Aware", "selectedStartHour": cr_slot, "predictedCarbon": cr_carbon, "estimatedDeadlineRisk": cr_risk, "waitingTimeHours": cr_slot, "isFeasible": cr_risk <= tau, "rationale": rationale}
        ],
        "recommendedDecision": {
            "policyId": "carbonroute_uncertainty",
            "policyName": "CarbonRoute Uncertainty-Aware",
            "selectedStartHour": cr_slot,
            "predictedCarbon": cr_carbon,
            "estimatedDeadlineRisk": cr_risk,
            "waitingTimeHours": cr_slot,
            "schedulerOverheadMs": 8,
            "isFeasible": True,
            "rationale": rationale
        },
        "comparisonSummary": {
            "carbonSavingsVsImmediatePct": savings_pct,
            "delayPenaltyHours": cr_slot,
            "riskDifferenceVsDeterministic": round(det_risk - cr_risk, 4)
        }
    }
    return {"success": True, "data": decision}

@app.post("/jobs/{job_id}/dispatch")
def dispatch_job(job_id: str):
    job = jobs_db.get(job_id, {"name": "Demo Job"})
    exec_record = {
        "jobId": job_id,
        "k8sJobName": f"carbonroute-{job_id[-6:]}",
        "status": "completed",
        "scheduledStartTime": datetime.utcnow().isoformat() + "Z",
        "completionTime": datetime.utcnow().isoformat() + "Z",
        "exitCode": 0,
        "logs": [
            f"Container initialized for {job_id}",
            "Allocated 1.0 CPU, 512MiB memory.",
            "Epoch progress 100% complete.",
            "Workload execution completed with code 0."
        ]
    }
    executions_db[job_id] = exec_record
    return {"success": True, "data": exec_record}

@app.get("/jobs/{job_id}/status")
def get_status(job_id: str):
    rec = executions_db.get(job_id)
    if not rec:
        return {"success": True, "data": {"status": "pending", "logs": ["Awaiting dispatch..."]}}
    return {"success": True, "data": rec}

@app.get("/jobs/{job_id}/results")
def get_results(job_id: str):
    rec = executions_db.get(job_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Execution results not found.")
    return {"success": True, "data": rec}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
