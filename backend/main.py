from fastapi import FastAPI, HTTPException, Body, UploadFile, File, APIRouter, Depends, Path, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse
from bson import ObjectId
import asyncio
import uuid
from datetime import datetime
from pydantic import BaseModel
import zipfile
import io
import re
import os
import requests
import time
import logging
from docx import Document
from collections import defaultdict
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from auth import create_access_token, verify_token
from passlib.context import CryptContext

from db import get_database, test_db_connection, ensure_indexes
from models import (
    Trainee, Admin, DashboardStats, WeeklyProgress, 
    PhaseDistribution, Training, Task, LoginRequest, SetPasswordRequest,
    ChangePasswordRequest, Batch, Activity, Mentor
)
from ai_agent import create_trainee_profile, test_ollama_connection, generate_training_recommendations, extract_text_from_pdf, extract_text_from_docx, fast_extract_resume_fields
from email_service import send_welcome_email_smtp, test_smtp_connection
from config import settings

app = FastAPI(
    title="Maverick Dashboard",
    version=settings.APP_VERSION,
    description="AI-Powered Training Dashboard Backend API"
)

# CORS Middleware Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080"],  # Allow frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db = get_database()

router = APIRouter()

BATCH_SIZE = 50
SKILL_PRIORITY = ["python", "java", ".net"]

# Store active WebSocket connections for activities
active_activity_ws_connections = []

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# In-memory cache for uploaded resumes (keyed by upload/session ID)
resume_cache = {}

def serialize_doc(doc):
    """Serialize MongoDB document for JSON response"""
    if doc and "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc

def collapse_single_letters(line):
    # If line is mostly single letters separated by spaces, collapse them
    if re.match(r'^([A-Za-z] ?)+$', line):
        # Collapse multiple spaces, then split and join letters into words
        words = [''.join(g) for g in re.findall(r'(?:[A-Za-z] ?)+', line)]
        return ' '.join([w.replace(' ', '') for w in words])
    return line

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

async def create_mentor_emp_id():
    # Generate a unique mentor empId like MENT-0001
    count = await db.mentors.count_documents({})
    return f"MENT-{count+1:04d}"

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    print("🚀 Starting Maverick Dashboard Backend...")
    
    # Try to ensure database indexes (non-critical)
    try:
        index_success = await ensure_indexes()
        if index_success:
            print("✅ Database indexes setup completed")
        else:
            print("⚠️  Database indexes setup skipped - server will work without optimal indexes")
    except Exception as e:
        print(f"⚠️  Database indexes setup error: {e} - continuing without indexes")
    
    # Test all services
    db_status, db_message = await test_db_connection()
    ollama_status, ollama_message = await test_ollama_connection()
    smtp_status, smtp_message = await test_smtp_connection()
    
    print(f"📊 Database: {'✅' if db_status else '❌'} {db_message}")
    print(f"🤖 Ollama: {'✅' if ollama_status else '❌'} {ollama_message}")
    print(f"📧 SMTP: {'✅' if smtp_status else '❌'} {smtp_message}")
    
    if db_status and smtp_status:
        print("🎉 Critical services are ready!")
    else:
        print("⚠️  Some critical services are not ready. Check the configuration.")

@app.get("/")
async def read_root():
    """Health check endpoint that tests all services"""
    db_status, db_message = await test_db_connection()
    ollama_status, ollama_message = await test_ollama_connection()
    smtp_status, smtp_message = await test_smtp_connection()

    overall_status = "ok" if db_status and smtp_status else "error"

    html_content = f"""
    <html>
    <head>
        <title>Maverick Dashboard - Health Check</title>
        <style>
            body {{ font-family: Arial, sans-serif; margin: 40px; }}
            table {{ border-collapse: collapse; width: 100%; }}
            th, td {{ border: 1px solid #ddd; padding: 8px; text-align: left; }}
            th {{ background-color: #f2f2f2; }}
            .status-ok {{ color: green; }}
            .status-error {{ color: red; }}
        </style>
    </head>
    <body>
        <h1>🚀 Maverick Dashboard</h1>
        <p><strong>Version:</strong> {settings.APP_VERSION}</p>
        <p><strong>Status:</strong> <span class="{'status-ok' if overall_status == 'ok' else 'status-error'}">{overall_status}</span></p>
        
        <h2>📊 Services Status</h2>
        <table>
            <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Message</th>
            </tr>
            <tr>
                <td>📊 Database</td>
                <td class="{'status-ok' if db_status else 'status-error'}">{'✅ OK' if db_status else '❌ Error'}</td>
                <td>{db_message}</td>
            </tr>
            <tr>
                <td>🤖 Ollama</td>
                <td class="{'status-ok' if ollama_status else 'status-error'}">{'✅ OK' if ollama_status else '❌ Error'}</td>
                <td>{ollama_message}</td>
            </tr>
            <tr>
                <td>📧 SMTP</td>
                <td class="{'status-ok' if smtp_status else 'status-error'}">{'✅ Configured' if smtp_status else '❌ Error'}</td>
                <td>{smtp_message} <br><em>Note: SMTP emails are sent from the backend using Gmail SMTP.</em></td>
            </tr>
        </table>
        
        <h2>🔗 API Endpoints</h2>
        <ul>
            <li><a href="/health-check">/health-check</a> - JSON health check</li>
            <li><a href="/trainees">/trainees</a> - List all trainees</li>
            <li><a href="/admins">/admins</a> - List all admins</li>
        </ul>
        
        <p><em>Frontend is available at: <a href="http://localhost:8080">http://localhost:8080</a></em></p>
        <p><strong>ℹ️ SMTP Integration:</strong> The backend now sends emails directly using Gmail SMTP. No frontend email integration required.</p>
        <p><em>© 2025 Hexaware Technologies. All rights reserved.</em></p>
    </body>
    </html>
    """
    
    return HTMLResponse(content=html_content)

@app.get("/health-check")
async def health_check():
    """Alternative health check endpoint"""
    return await read_root()

@app.post("/auth/login")
async def login(login_request: LoginRequest):
    """Handle user login with AI-generated profile creation for new trainees and mentors"""
    try:
        # Determine collection based on role
        if login_request.role == "mentor":
            user_collection = db["mentors"]
        else:
            user_collection = db[f"{login_request.role}s"]
        # Support login by empId or email
        user = None
        if hasattr(login_request, 'empId') and login_request.empId:
            user = await user_collection.find_one({"empId": login_request.empId})
        elif login_request.email:
            user = await user_collection.find_one({"email": login_request.email})

        if user:
            # User exists - this is a login attempt
            if not login_request.password:
                raise HTTPException(status_code=400, detail="User already exists. Please login with your password.")
            # Use pwd_context.verify for all roles
            if pwd_context.verify(login_request.password, user.get("password", "")):
                await user_collection.update_one({"_id": user["_id"]}, {"$set": {"last_login": datetime.now().isoformat()}})
                user["last_login"] = datetime.now().isoformat()
                return JSONResponse(content=serialize_doc(user))
            else:
                raise HTTPException(status_code=401, detail="Invalid credentials")
        else:
            # Registration logic for new mentor
            if login_request.role == 'mentor' and login_request.name and login_request.email:
                try:
                    print(f"Creating new mentor profile for: {login_request.email} - {login_request.name}")
                    emp_id = await create_mentor_emp_id()
                    hashed_pw = pwd_context.hash(login_request.password or "mentor123")
                    new_mentor = Mentor(
                        name=login_request.name,
                        email=login_request.email,
                        password=hashed_pw,
                        empId=emp_id,
                        specialization="General",
                        created_at=datetime.now().isoformat(),
                        last_login=datetime.now().isoformat()
                    )
                    result = await db.mentors.insert_one(new_mentor.dict())
                    if result.inserted_id:
                        print(f"✅ Mentor profile created successfully: {emp_id}")
                        return JSONResponse(content={
                            "status": "account_created",
                            "user": serialize_doc(new_mentor.dict()),
                            "message": "Mentor account created successfully"
                        })
                    else:
                        raise HTTPException(status_code=500, detail="Failed to create mentor account.")
                except Exception as e:
                    raise HTTPException(status_code=500, detail=f"Error creating mentor: {str(e)}")
            # Registration logic for new trainee (existing logic)
            elif login_request.role == 'trainee' and login_request.name and login_request.email:
                try:
                    print(f"Creating new trainee profile for: {login_request.email} - {login_request.name}")
                    profile = await create_trainee_profile(login_request.email)
                    hashed_pw = pwd_context.hash(profile["password"])
                    new_trainee = Trainee(
                        name=login_request.name,
                        email=login_request.email,
                        password=hashed_pw,
                        empId=profile["empId"],
                        phase=1,
                        progress=0,
                        score=0,
                        status="active",
                        specialization="Pending",
                        created_at=datetime.now().isoformat(),
                        last_login=datetime.now().isoformat()
                    )
                    result = await db.trainees.insert_one(new_trainee.model_dump())
                    if result.inserted_id:
                        print(f"✅ Trainee profile created successfully: {profile['empId']}")
                        email_result = await send_welcome_email_smtp(login_request.email, login_request.name, profile["empId"], profile["password"])
                        return JSONResponse(content={
                            "status": "account_created",
                            "user": serialize_doc(new_trainee.dict()),
                            "message": "Account created successfully",
                            "emailResult": email_result
                        })
                    else:
                        raise HTTPException(status_code=500, detail="Failed to create trainee account.")
                except Exception as e:
                    raise HTTPException(status_code=500, detail=f"Error creating trainee: {str(e)}")
            else:
                raise HTTPException(status_code=404, detail="User not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Login error: {str(e)}")

# Helper to create mentor empId
async def create_mentor_emp_id():
    try:
        pipeline = [
            {"$match": {"empId": {"$regex": "^MEN-\\d{4}$"}}},
            {"$addFields": {"idNumber": {"$toInt": {"$substr": ["$empId", 4, 4]}}}},
            {"$sort": {"idNumber": -1}},
            {"$limit": 1}
        ]
        result = await db.mentors.aggregate(pipeline).to_list(1)
        if result:
            last_id = result[0]["idNumber"]
            next_id = last_id + 1
        else:
            next_id = 1
        return f"MEN-{next_id:04d}"
    except Exception as e:
        print(f"Error generating mentor ID: {e}")
        return f"MEN-{random.randint(1000, 9999)}"

@app.post("/api/user/set-password")
async def set_password(request: SetPasswordRequest):
    """Set a new password for a user and mark it as not temporary."""
    try:
        # For now, we only support trainees changing passwords this way
        user_collection = db.trainees
        
        # In a real app, you'd hash the password here.
        # For now, storing plaintext to match existing logic.
        new_password = request.new_password

        result = await user_collection.update_one(
            {"email": request.email},
            {"$set": {
                "password": new_password,
                "password_is_temporary": False
            }}
        )

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="User not found")

        if result.modified_count == 0:
            # This could happen if the user provides the same password
            # We'll still mark it as not temporary if needed
            await user_collection.update_one(
                {"email": request.email},
                {"$set": {"password_is_temporary": False}}
            )

        return JSONResponse(content={"status": "success", "message": "Password updated successfully"})

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Set Password error: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/api/user/change-password")
async def change_password(request: ChangePasswordRequest):
    """Allow a logged-in user to change their password (no old password required)."""
    try:
        user_collection = db.trainees
        user = await user_collection.find_one({"email": request.email})

        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        # Directly update to new password (no old password check)
        result = await user_collection.update_one(
            {"_id": user["_id"]},
            {"$set": {"password": request.new_password, "password_is_temporary": False}}
        )
        
        if result.modified_count == 0:
            # This can happen if the new password is the same as the old one
            raise HTTPException(status_code=400, detail="New password cannot be the same as the old password.")

        return JSONResponse(content={"status": "success", "message": "Password changed successfully"})

    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Change Password error: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.get("/admins")
async def get_admins():
    """Get all admins (without passwords for security)"""
    try:
        data = []
        cursor = db["admins"].find({}, {"password": 0})  # Exclude passwords
        async for document in cursor:
            data.append(serialize_doc(document))
        return JSONResponse(content={
            "admins": data,
            "count": len(data)
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching admins: {str(e)}")

@app.get("/mentors")
async def list_mentors():
    mentors = await db.mentors.find().to_list(length=100)
    return [serialize_doc(m) for m in mentors]

# Basic CRUD for trainees
@app.get("/trainees")
async def get_trainees():
    """Get all trainees"""
    try:
        data = []
        cursor = db["trainees"].find()
        async for document in cursor:
            data.append(serialize_doc(document))
        return JSONResponse(content=data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching trainees: {str(e)}")

@app.get("/trainees/{emp_id}")
async def get_trainee_by_empid(emp_id: str):
    """Get trainee by employee ID"""
    try:
        trainee = await db["trainees"].find_one({"empId": emp_id})
        if trainee:
            return JSONResponse(content=serialize_doc(trainee))
        raise HTTPException(status_code=404, detail="Trainee not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching trainee: {str(e)}")

@app.get("/trainees/email/{email}")
async def get_trainee_by_email(email: str):
    """Get trainee by email"""
    try:
        trainee = await db["trainees"].find_one({"email": email})
        if trainee:
            return JSONResponse(content=serialize_doc(trainee))
        raise HTTPException(status_code=404, detail="Trainee not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching trainee: {str(e)}")

@app.post("/trainees/{emp_id}/recommendations")
async def get_trainee_recommendations(emp_id: str):
    """Get AI-generated training recommendations for a trainee"""
    try:
        trainee = await db["trainees"].find_one({"empId": emp_id})
        if not trainee:
            raise HTTPException(status_code=404, detail="Trainee not found")
        
        recommendations = await generate_training_recommendations(trainee)
        return JSONResponse(content=recommendations)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating recommendations: {str(e)}")

@app.put("/trainees/{emp_id}/progress")
async def update_trainee_progress(emp_id: str, progress_data: dict):
    """Update trainee progress and scores"""
    try:
        update_data = {
            "progress": progress_data.get("progress", 0),
            "score": progress_data.get("score", 0),
            "phase": progress_data.get("phase", 1),
            "specialization": progress_data.get("specialization", "Pending")
        }
        
        result = await db["trainees"].update_one(
            {"empId": emp_id},
            {"$set": update_data}
        )
        
        if result.modified_count > 0:
            return JSONResponse(content={"message": "Progress updated successfully"})
        else:
            raise HTTPException(status_code=404, detail="Trainee not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error updating progress: {str(e)}")

@app.post("/api/admin/bulk-create-trainees")
async def bulk_create_trainees(trainees_data: list = Body(...)):
    """Bulk create trainee accounts from admin upload"""
    try:
        print(f"🚀 Bulk creation request received for {len(trainees_data)} trainees")
        created_trainees = []
        failed_trainees = []
        for i, trainee_info in enumerate(trainees_data):
            try:
                print(f"📝 Processing trainee {i+1}/{len(trainees_data)}: {trainee_info.get('name', 'Unknown')}")
                
                # Validate required fields
                if not trainee_info.get("name") or not trainee_info.get("email"):
                    print(f"❌ Validation failed for trainee {i+1}: Missing name or email")
                    failed_trainees.append({
                        "name": trainee_info.get("name", "Unknown"),
                        "email": trainee_info.get("email", "Unknown"),
                        "error": "Name and email are required"
                    })
                    continue
                
                # Check if trainee already exists
                existing_trainee = await db.trainees.find_one({"email": trainee_info["email"]})
                if existing_trainee:
                    print(f"⚠️ Trainee already exists: {trainee_info['email']}")
                    failed_trainees.append({
                        "name": trainee_info["name"],
                        "email": trainee_info["email"],
                        "error": "Trainee already exists"
                    })
                    continue
                
                # Generate AI profile
                print(f"🤖 Generating profile for {trainee_info['email']}")
                profile = await create_trainee_profile(trainee_info["email"])
                
                # Create trainee document
                new_trainee = Trainee(
                    name=trainee_info["name"],  # Use provided name
                    email=trainee_info["email"],
                    password=profile["password"],
                    empId=profile["empId"],
                    phase=1,
                    progress=0,
                    score=0,
                    status="active",
                    specialization="Pending",
                    created_at=datetime.now().isoformat(),
                    last_login=datetime.now().isoformat()
                )
                
                # Store in database
                print(f"💾 Storing trainee in database: {profile['empId']}")
                result = await db.trainees.insert_one(new_trainee.model_dump())
                if result.inserted_id:
                    # Prepare email data for frontend to send via EmailJS
                    print(f"📧 Preparing email data for {trainee_info['email']}")
                    email_result = await send_welcome_email_smtp(
                        trainee_info["email"],
                        trainee_info["name"],
                        profile["empId"],
                        profile["password"]
                    )
                    
                    created_trainees.append({
                        "name": trainee_info["name"],
                        "email": trainee_info["email"],
                        "empId": profile["empId"],
                        "password": profile["password"],
                        "emailResult": email_result
                    })
                    
                    print(f"✅ Trainee created successfully: {profile['empId']} - {trainee_info['name']}")
                else:
                    print(f"❌ Database insertion failed for {trainee_info['email']}")
                    failed_trainees.append({
                        "name": trainee_info["name"],
                        "email": trainee_info["email"],
                        "error": "Failed to create trainee account"
                    })
            except Exception as e:
                print(f"❌ Error processing trainee {i+1}: {str(e)}")
                failed_trainees.append({
                    "name": trainee_info.get("name", "Unknown"),
                    "email": trainee_info.get("email", "Unknown"),
                    "error": str(e)
                })
        print(f"🎉 Bulk creation completed: {len(created_trainees)} created, {len(failed_trainees)} failed")
        response_data = {
            "status": "success",
            "message": f"Bulk trainee creation completed. {len(created_trainees)} created, {len(failed_trainees)} failed.",
            "created_trainees": created_trainees,
            "failed_trainees": failed_trainees,
            "summary": {
                "total_requested": len(trainees_data),
                "successful": len(created_trainees),
                "failed": len(failed_trainees)
            }
        }
        return JSONResponse(content=response_data)
    except Exception as e:
        print(f"❌ Bulk creation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Bulk creation error: {str(e)}")

@router.post("/signup/upload-resume")
async def upload_resume_individual(file: UploadFile = File(...)):
    """Accept a single resume upload, store in cache, return upload_id for admin approval flow."""
    file_content = await file.read()
    upload_id = str(uuid.uuid4())
    resume_cache[upload_id] = {
        'filename': file.filename,
        'content': file_content,
        'timestamp': time.time()
    }
    return {"status": "pending_approval", "upload_id": upload_id}

@router.post("/onboarding/upload-resumes")
async def upload_resumes(file: UploadFile = File(...)):
    """Accept a zip of resumes, store each in cache, return list of upload_ids for admin approval flow."""
    file_content = await file.read()
    file_extension = file.filename.lower().split('.')[-1] if file.filename else ''
    upload_ids = []
    if file_extension == 'zip':
        with zipfile.ZipFile(io.BytesIO(file_content)) as zip_file:
            resume_files = [f for f in zip_file.namelist() if f.lower().endswith('.pdf') or f.lower().endswith('.docx')]
            if not resume_files:
                raise HTTPException(status_code=400, detail="No PDF or DOCX files found in zip")
                for resume_name in resume_files:
                        resume_bytes = zip_file.read(resume_name)
                upload_id = str(uuid.uuid4())
                resume_cache[upload_id] = {
                    'filename': resume_name,
                    'content': resume_bytes,
                    'timestamp': time.time()
                }
                upload_ids.append(upload_id)
        return {"status": "pending_approval", "upload_ids": upload_ids}
    elif file_extension == 'docx':
        upload_id = str(uuid.uuid4())
        resume_cache[upload_id] = {
            'filename': file.filename,
            'content': file_content,
            'timestamp': time.time()
        }
        return {"status": "pending_approval", "upload_ids": [upload_id]}
    else:
        raise HTTPException(status_code=400, detail="Unsupported file type. Please upload a ZIP file containing PDFs or DOCX files, or a single DOCX file.")

# Admin approval endpoint (example)
@router.post("/onboarding/approve-resume")
async def approve_resume(upload_id: str = Body(...)):
    """On approval, extract info from resume, return JSON, and delete from cache."""
    entry = resume_cache.pop(upload_id, None)
    if not entry:
        raise HTTPException(status_code=404, detail="Resume not found in cache.")
    filename = entry['filename']
    content = entry['content']
    if filename.lower().endswith('.pdf'):
        text = extract_text_from_pdf(content)
    elif filename.lower().endswith('.docx'):
        text = extract_text_from_docx(content)
    else:
        raise HTTPException(status_code=400, detail="Unsupported file type for extraction.")

    fast_result = fast_extract_resume_fields(text, SKILL_PRIORITY)
    name = fast_result.get("name") if fast_result and fast_result.get("name") else 'unknown'
    email = fast_result.get("email") if fast_result and fast_result.get("email") else 'unknown'
    skills = fast_result.get("skills") if fast_result and fast_result.get("skills") else ['unknown']
    skills = [s.lower() for s in skills]
    return {"name": name, "email": email, "skills": skills}

# Admin rejection endpoint (example)
@router.post("/onboarding/reject-resume")
async def reject_resume(upload_id: str = Body(...)):
    """On rejection, delete resume from cache."""
    entry = resume_cache.pop(upload_id, None)
    if not entry:
        raise HTTPException(status_code=404, detail="Resume not found in cache.")
    return {"status": "deleted"}

@router.post("/onboarding/create-accounts-for-batch")
async def create_accounts_for_batch(request: dict = Body(...)):
    try:
        batch_id = request.get("batch_id")
        if not batch_id:
            raise HTTPException(status_code=400, detail="batch_id is required")
        batch = await db.batches.find_one({"_id": ObjectId(batch_id)})
        if not batch:
            raise HTTPException(status_code=404, detail="Batch not found")
        if batch.get("accounts_created"):
            return {"status": "already_created", "message": "Accounts already created for this batch."}
        created_trainees = []
        failed_trainees = []
        for trainee in batch["trainees"]:
            try:
                existing = await db.trainees.find_one({"email": trainee["email"]})
                if existing:
                    failed_trainees.append({
                        "name": trainee["name"],
                        "email": trainee["email"],
                        "error": "Trainee already exists"
                    })
                    print(f"[WARN] Trainee already exists: {trainee['email']}")
                    continue
                profile = await create_trainee_profile(trainee["email"])
                new_trainee = Trainee(
                    name=trainee["name"],
                    email=trainee["email"],
                    password=profile["password"],
                    empId=profile["empId"],
                    phase=batch.get("phase", 1),
                    progress=0,
                    score=0,
                    status="active",
                    specialization=batch.get("skill", "Pending"),
                    created_at=datetime.now().isoformat(),
                    last_login=datetime.now().isoformat()
                )
                result = await db.trainees.insert_one(new_trainee.model_dump())
                if result.inserted_id:
                    email_result = await send_welcome_email_smtp(
                        trainee["email"],
                        trainee["name"],
                        profile["empId"],
                        profile["password"]
                    )
                    created_trainees.append({
                        "name": trainee["name"],
                        "email": trainee["email"],
                        "empId": profile["empId"],
                        "password": profile["password"],
                        "emailResult": email_result
                    })
                    print(f"[INFO] Account created and email sent for: {trainee['email']}")
                else:
                    failed_trainees.append({
                        "name": trainee["name"],
                        "email": trainee["email"],
                        "error": "Failed to create trainee account"
                    })
                    print(f"[ERROR] Failed to create trainee account: {trainee['email']}")
            except Exception as e:
                failed_trainees.append({
                    "name": trainee.get("name", "unknown"),
                    "email": trainee.get("email", "unknown"),
                    "error": str(e)
                })
                print(f"[ERROR] Exception for {trainee.get('email', 'unknown')}: {e}")
        await db.batches.update_one({"_id": ObjectId(batch_id)}, {"$set": {"accounts_created": True}})
        print(f"[INFO] Batch {batch_id} marked as accounts_created.")
        return {
            "status": "success",
            "created_trainees": created_trainees,
            "failed_trainees": failed_trainees,
            "summary": {
                "total": len(batch["trainees"]),
                "created": len(created_trainees),
                "failed": len(failed_trainees)
            }
        }
    except Exception as e:
        print(f"[FATAL] Error in create_accounts_for_batch: {e}")
        raise HTTPException(status_code=500, detail=f"Error creating accounts for batch: {str(e)}")

@router.get("/batch/{batch_id}")
async def get_batch(batch_id: str):
    batch = await db.batches.find_one({"_id": ObjectId(batch_id)})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    batch["_id"] = str(batch["_id"])
    return batch

@router.get("/batches")
async def list_batches():
    batches = []
    cursor = db.batches.find()
    async for batch in cursor:
        batch["_id"] = str(batch["_id"])
        batches.append(batch)
    return batches

@router.get("/batches/phase/{phase}")
async def list_batches_by_phase(phase: int):
    batches = []
    cursor = db.batches.find({"phase": phase})
    async for batch in cursor:
        batch["_id"] = str(batch["_id"])
        batches.append(batch)
    return batches

@router.get("/batches/grouped")
async def grouped_batches():
    # Group batches by phase and batch_number, then by skill
    batches = []
    cursor = db.batches.find()
    async for batch in cursor:
        batch["_id"] = str(batch["_id"])
        batches.append(batch)
    grouped = {}
    for batch in batches:
        phase = batch.get("phase", 1)
        batch_number = batch.get("batch_number", 0)
        skill = batch.get("skill", "mixed")
        if phase not in grouped:
            grouped[phase] = {}
        if batch_number not in grouped[phase]:
            grouped[phase][batch_number] = {}
        grouped[phase][batch_number][skill] = batch
    return grouped

@app.get("/trainees/unknown")
async def get_unknown_trainees():
    """Get all trainees with unknown fields"""
    try:
        data = []
        cursor = db["trainees"].find({
            "$or": [
                {"name": "unknown"},
                {"email": "unknown"},
                {"skill": "unknown"}
            ]
        })
        async for document in cursor:
            data.append(serialize_doc(document))
        return JSONResponse(content=data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching unknown trainees: {str(e)}")

@router.get("/batches/{batch_id}/skill-groups")
async def get_skill_groups_for_batch(batch_id: str):
    """Return summary for each skill group in a batch: skill name, average progress, trainee count."""
    batch = await db.batches.find_one({"_id": ObjectId(batch_id)})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    skill_groups = {}
    for trainee in batch.get("trainees", []):
        skill = trainee.get("skill", "unknown").lower()
        if skill not in skill_groups:
            skill_groups[skill] = {"trainees": [], "total_progress": 0}
        skill_groups[skill]["trainees"].append(trainee)
        skill_groups[skill]["total_progress"] += trainee.get("progress", 0)
    result = []
    for skill, data in skill_groups.items():
        count = len(data["trainees"])
        avg_progress = data["total_progress"] / count if count > 0 else 0
        result.append({
            "skill": skill,
            "trainee_count": count,
            "average_progress": avg_progress
        })
    return result

@router.get("/batches/{batch_id}/skill-groups/{skill}/trainees")
async def get_trainees_for_skill_group(batch_id: str, skill: str = Path(...)):
    """Return all trainees in a batch for a given skill group, with their progress."""
    batch = await db.batches.find_one({"_id": ObjectId(batch_id)})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    trainees = [t for t in batch.get("trainees", []) if t.get("skill", "").lower() == skill.lower()]
    return trainees

@app.get("/dashboard/stats")
async def get_dashboard_stats():
    """Aggregate and return all key dashboard statistics for the admin dashboard."""
    try:
        # Total trainees
        total_trainees = await db["trainees"].count_documents({})
        # Active trainees
        active_trainees = await db["trainees"].count_documents({"status": "active"})
        # Completed phase 1 (assuming phase > 1 means completed phase 1)
        completed_phase1 = await db["trainees"].count_documents({"phase": {"$gt": 1}})
        # Average score
        pipeline = [
            {"$group": {"_id": None, "avgScore": {"$avg": "$score"}}}
        ]
        avg_score_result = await db["trainees"].aggregate(pipeline).to_list(length=1)
        avg_score = round(avg_score_result[0]["avgScore"], 2) if avg_score_result and avg_score_result[0]["avgScore"] is not None else 0

        # Phase distribution (by phase and skill)
        phase_dist_pipeline = [
            {"$group": {"_id": {"phase": "$phase", "skill": "$specialization"}, "count": {"$sum": 1}}}
        ]
        phase_dist_result = await db["trainees"].aggregate(phase_dist_pipeline).to_list(length=100)
        phase_distribution = []
        for entry in phase_dist_result:
            phase = entry["_id"].get("phase", 1)
            skill = entry["_id"].get("skill", "Unknown")
            phase_distribution.append({
                "phase": phase,
                "skill": skill,
                "count": entry["count"]
            })

        # Weekly progress (mocked if no timestamp data)
        # If you have created_at or similar, you can aggregate by week
        # For now, return an empty list or mock data
        weekly_progress = []
        # Example for real aggregation if you have created_at:
        # pipeline = [
        #     {"$group": {
        #         "_id": {"$isoWeek": "$created_at"},
        #         "newJoiners": {"$sum": 1},
        #         "avgScore": {"$avg": "$score"}
        #     }}
        # ]
        # weekly_progress = await db["trainees"].aggregate(pipeline).to_list(length=10)

        return {
            "totalTrainees": total_trainees,
            "activeTrainees": active_trainees,
            "completedPhase1": completed_phase1,
            "avgScore": avg_score,
            "phaseDistribution": phase_distribution,
            "weeklyProgress": weekly_progress
        }
    except Exception as e:
        print(f"[ERROR] Dashboard stats aggregation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Dashboard stats error: {str(e)}")

@app.get("/batches/weekly-progress")
async def get_batches_weekly_progress():
    """Return weekly progress for each batch, grouped by phase."""
    batches = await db.batches.find().to_list(length=100)
    result = []
    for batch in batches:
        batch_id = str(batch['_id'])
        batch_name = f"{batch.get('skill', 'Batch').capitalize()} Batch {batch.get('batch_number', '')}"
        phase = batch.get('phase', 1)
        # Group progress by week
        weekly = defaultdict(list)
        for trainee in batch.get('trainees', []):
            # Use progress_updated_at or created_at
            date_str = trainee.get('progress_updated_at') or trainee.get('created_at')
            if not date_str:
                continue
            try:
                dt = datetime.fromisoformat(date_str)
            except Exception:
                continue
            week = dt.strftime('%Y-W%U')
            weekly[week].append(trainee.get('progress', 0))
        weekly_progress = [
            { 'week': week, 'progress': round(sum(vals)/len(vals), 2) }
            for week, vals in sorted(weekly.items())
        ]
        result.append({
            'batchId': batch_id,
            'batchName': batch_name,
            'phase': phase,
            'weeklyProgress': weekly_progress
        })
    return result

@app.get("/activities")
async def get_activities(limit: int = 3, offset: int = 0):
    """Fetch recent activities, paginated and sorted by timestamp descending."""
    cursor = db.activities.find().sort("timestamp", -1).skip(offset).limit(limit)
    activities = []
    async for doc in cursor:
        doc["id"] = str(doc["_id"])
        doc.pop("_id", None)
        activities.append(doc)
    return activities

@app.websocket('/ws/activities')
async def activities_ws(websocket: WebSocket):
    await websocket.accept()
    active_activity_ws_connections.append(websocket)
    try:
        while True:
            await websocket.receive_text()  # Keep alive
    except WebSocketDisconnect:
        active_activity_ws_connections.remove(websocket)

@app.post("/activities")
async def log_activity(activity: Activity):
    """Log a new activity and broadcast to WebSocket clients."""
    activity_dict = activity.dict()
    activity_dict["timestamp"] = activity_dict.get("timestamp") or datetime.utcnow().isoformat()
    result = await db.activities.insert_one(activity_dict)
    activity_dict["id"] = str(result.inserted_id)
    # Broadcast to all connected WebSocket clients
    import json
    for ws in active_activity_ws_connections[:]:
        try:
            await ws.send_text(json.dumps(activity_dict))
        except Exception:
            try:
                active_activity_ws_connections.remove(ws)
            except ValueError:
                pass
    return activity_dict

@app.get("/analytics/skill-heatmap")
async def skill_heatmap():
    """Return a heatmap matrix of average skill mastery per batch."""
    batches = await db.batches.find().to_list(length=100)
    skill_set = set()
    batch_names = []
    # Collect all skills and batch names
    for batch in batches:
        batch_names.append(f"{batch.get('skill', 'Batch').capitalize()} Batch {batch.get('batch_number', '')}")
        for trainee in batch.get('trainees', []):
            if 'skills' in trainee and isinstance(trainee['skills'], list):
                for skill in trainee['skills']:
                    skill_set.add(skill.capitalize())
            elif 'skill' in trainee:
                skill_set.add(trainee['skill'].capitalize())
    skills = sorted(skill_set)
    # Build matrix: skills x batches
    matrix = []
    for skill in skills:
        row = []
        for batch in batches:
            # Find all trainees in this batch with this skill
            values = []
            for trainee in batch.get('trainees', []):
                t_skills = []
                if 'skills' in trainee and isinstance(trainee['skills'], list):
                    t_skills = [s.capitalize() for s in trainee['skills']]
                elif 'skill' in trainee:
                    t_skills = [trainee['skill'].capitalize()]
                if skill in t_skills:
                    # Use progress or score as mastery
                    if 'progress' in trainee:
                        values.append(trainee['progress'])
                    elif 'score' in trainee:
                        values.append(trainee['score'])
            avg = round(sum(values)/len(values), 2) if values else None
            row.append(avg)
        matrix.append(row)
    return {"skills": skills, "batches": batch_names, "matrix": matrix}

@app.get("/analytics/score-distribution")
async def score_distribution():
    """Return score distribution buckets and counts for all trainees, using 15-point intervals, excluding 0-15."""
    trainees = await db.trainees.find().to_list(length=10000)
    # Buckets: 16-30, 31-45, 46-60, 61-75, 76-90, 91-100
    buckets = ["16-30", "31-45", "46-60", "61-75", "76-90", "91-100"]
    bucket_ranges = [(16, 30), (31, 45), (46, 60), (61, 75), (76, 90), (91, 100)]
    counts = [0] * len(buckets)
    for t in trainees:
        score = t.get('score', 0)
        if score <= 15:
            continue  # Exclude fresh accounts
        for i, (low, high) in enumerate(bucket_ranges):
            if low <= score <= high:
                counts[i] += 1
                break
    # If all buckets are zero, return empty list
    if all(c == 0 for c in counts):
        return []
    return [{"range": buckets[i], "count": counts[i]} for i in range(len(buckets))]

@app.get("/analytics/completion-timeline")
async def completion_timeline():
    """Return completions per month (count of trainees who completed in each month)."""
    # Assume phase > 1 means completed, and use last phase update or created_at as completion date
    trainees = await db.trainees.find({"phase": {"$gt": 1}}).to_list(length=10000)
    from collections import Counter
    from datetime import datetime
    month_counts = Counter()
    for t in trainees:
        date_str = t.get('progress_updated_at') or t.get('created_at')
        if not date_str:
            continue
        try:
            dt = datetime.fromisoformat(date_str)
            month = dt.strftime('%b')
            month_counts[month] += 1
        except Exception:
            continue
    # Sort by month order (Jan, Feb, ...)
    months_order = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    result = [{"month": m, "completed": month_counts[m]} for m in months_order if m in month_counts]
    return result

@app.post("/token")
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    # Replace with real user validation
    if form_data.username == "admin" and form_data.password == "password":
        access_token = create_access_token(data={"sub": form_data.username})
        return {"access_token": access_token, "token_type": "bearer"}
    raise HTTPException(status_code=400, detail="Incorrect username or password")

def get_current_user(token: str = Depends(oauth2_scheme)):
    payload = verify_token(token)
    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return payload

@app.get("/protected")
def protected_route(current_user: dict = Depends(get_current_user)):
    return {"msg": "You are authenticated", "user": current_user}

@app.post("/signup")
async def signup(name: str = Body(...), email: str = Body(...)):
    user_collection = db["trainees"]
    # Check if user exists
    existing = await user_collection.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="User already exists")
    # Generate empId and temp password
    profile = await create_trainee_profile(email)
    empId = profile["empId"]
    temp_password = profile["password"]
    hashed_pw = hash_password(temp_password)
    trainee = Trainee(name=name, email=email, password=hashed_pw, empId=empId)
    await user_collection.insert_one(trainee.dict())
    await send_welcome_email_smtp(email, name, empId, temp_password)
    return {"status": "account_created", "message": "Check your email for your Employee ID and temporary password."}

@router.get("/onboarding/pending-resumes")
async def list_pending_resumes():
    """Return a list of all pending resumes in the in-memory cache."""
    return [
        {"upload_id": upload_id, "filename": entry["filename"]}
        for upload_id, entry in resume_cache.items()
    ]

@router.post("/onboarding/auto-allocate-and-create-account")
async def auto_allocate_and_create_account(payload: dict = Body(...)):
    """Auto-allocate a trainee to a batch based on skill and batch availability, create account, and send credentials."""
    name = payload.get("name")
    email = payload.get("email")
    skills = payload.get("skills", [])
    if not name or not email or not skills:
        raise HTTPException(status_code=400, detail="Missing name, email, or skills.")
    skill = None
    for s in SKILL_PRIORITY:
        if s in [sk.lower() for sk in skills]:
            skill = s
            break
    if not skill:
        skill = "mixed"
    # Find all batches for this skill that are not next_batch
    batches = await db.batches.find({"skill": skill, "is_next_batch": False}).to_list(length=100)
    # Find the first batch that is not full
    batch = next((b for b in batches if len(b.get("trainees", [])) < BATCH_SIZE), None)
    if batch:
        batch_id = batch["_id"]
        # Check if trainee already in batch
        already_in_batch = any(t.get("email") == email for t in batch.get("trainees", []))
        if not already_in_batch:
            await db.batches.update_one({"_id": batch_id}, {"$push": {"trainees": {"name": name, "email": email, "skills": skills, "skill": skill}}})
    else:
        now = datetime.now().isoformat()
        batch_doc = Batch(
            batch_number=1,  # or increment as needed
            skill=skill,
            phase=1,
            is_next_batch=False,
            trainees=[{"name": name, "email": email, "skills": skills, "skill": skill}],
            created_at=now
        )
        result = await db.batches.insert_one(batch_doc.model_dump())
        batch_id = result.inserted_id
    # Create trainee account
    existing = await db.trainees.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Trainee already exists.")
    profile = await create_trainee_profile(email)
    new_trainee = Trainee(
        name=name,
        email=email,
        password=profile["password"],
        empId=profile["empId"],
        phase=1,
        progress=0,
        score=0,
        status="active",
        specialization=skill,
        created_at=datetime.now().isoformat(),
        last_login=datetime.now().isoformat()
    )
    result = await db.trainees.insert_one(new_trainee.model_dump())
    if result.inserted_id:
        email_result = await send_welcome_email_smtp(
            email,
            name,
            profile["empId"],
            profile["password"]
        )
        return {
            "status": "success",
            "batch_id": str(batch_id),
            "empId": profile["empId"],
            "password": profile["password"],
            "emailResult": email_result
        }
    else:
        raise HTTPException(status_code=500, detail="Failed to create trainee account.")

@router.post("/onboarding/create-account-for-trainee")
async def create_account_for_trainee(payload: dict = Body(...)):
    """Create an account for a single trainee in a batch, generate credentials, and send welcome email."""
    email = payload.get("email")
    batch_id = payload.get("batch_id")
    if not email or not batch_id:
        raise HTTPException(status_code=400, detail="Missing email or batch_id.")
    batch = await db.batches.find_one({"_id": ObjectId(batch_id)})
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found.")
    trainee = next((t for t in batch.get("trainees", []) if t.get("email") == email), None)
    if not trainee:
        raise HTTPException(status_code=404, detail="Trainee not found in batch.")
    existing = await db.trainees.find_one({"email": email})
    if existing:
        return {"status": "already_created", "empId": existing.get("empId"), "message": "Account already exists for this trainee."}
    profile = await create_trainee_profile(email)
    new_trainee = Trainee(
        name=trainee["name"],
        email=email,
        password=profile["password"],
        empId=profile["empId"],
        phase=batch.get("phase", 1),
        progress=0,
        score=0,
        status="active",
        specialization=batch.get("skill", "Pending"),
        created_at=datetime.now().isoformat(),
        last_login=datetime.now().isoformat()
    )
    result = await db.trainees.insert_one(new_trainee.model_dump())
    if result.inserted_id:
        email_result = await send_welcome_email_smtp(
            email,
            trainee["name"],
            profile["empId"],
            profile["password"]
        )
        return {
            "status": "success",
            "empId": profile["empId"],
            "password": profile["password"],
            "emailResult": email_result
        }
    else:
        raise HTTPException(status_code=500, detail="Failed to create trainee account.")

@app.post("/onboarding/create-mentor-account")
async def create_mentor_account(payload: dict = Body(...)):
    """Admin creates a mentor account, credentials are emailed and stored in MongoDB."""
    name = payload.get("name")
    email = payload.get("email")
    specialization = payload.get("specialization", "General")
    if not name or not email:
        raise HTTPException(status_code=400, detail="Missing name or email.")
    # Check if mentor already exists
    existing = await db.mentors.find_one({"email": email})
    if existing:
        return {"status": "already_created", "empId": existing.get("empId"), "message": "Mentor already exists for this email."}
    # Generate empId and temp password
    emp_id = await create_mentor_emp_id()
    temp_password = f"Mentor{str(uuid.uuid4())[:8]}"
    hashed_pw = pwd_context.hash(temp_password)
    new_mentor = Mentor(
        name=name,
        email=email,
        password=hashed_pw,
        empId=emp_id,
        specialization=specialization,
        created_at=datetime.now().isoformat(),
        last_login=datetime.now().isoformat()
    )
    await db.mentors.insert_one(new_mentor.dict())
    # Send credentials via email
    subject = "🎉 Welcome to Maverick Dashboard - Mentor Credentials"
    body = f"""
Hi {name},

You have been added as a Mentor on Maverick Dashboard.

Your Employee ID: {emp_id}
Your Temporary Password: {temp_password}

Login at: http://localhost:8080

Best regards,\nMaverick Pathfinder Training Team
"""
    from email.message import EmailMessage
    import aiosmtplib
    msg = EmailMessage()
    msg["From"] = settings.FROM_EMAIL
    msg["To"] = email
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=settings.SMTP_PASS,
            start_tls=True,
        )
        email_result = {"success": True, "message": f"Email sent to {email}"}
    except Exception as e:
        email_result = {"success": False, "message": str(e)}
    return {
        "status": "success",
        "empId": emp_id,
        "password": temp_password,
        "emailResult": email_result
    }

@app.get("/trainees/{emp_id}/tasks")
async def get_trainee_tasks(emp_id: str):
    """Get all tasks assigned to a trainee by empId"""
    try:
        tasks = []
        cursor = db["tasks"].find({"assignedTo": emp_id})
        async for task in cursor:
            task["_id"] = str(task["_id"])
            tasks.append(task)
        return {"tasks": tasks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching tasks: {str(e)}")

app.include_router(router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
