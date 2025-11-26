import asyncio, random, string, re, logging
from html import escape

# Logger

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("db_init")

# Simulated models

class UserModel: _db = []; @classmethod
async def create(cls, data): cls._db.append(data); return data
class ChallengeModel: _db = []; @classmethod
async def create(cls, data): cls._db.append(data); return data
class HintModel: _db = []; @classmethod
async def create(cls, data): cls._db.append(data); return data
class WalletModel: _db = []; @classmethod
async def create(cls, data): cls._db.append(data); return data

# Cache

datacache = {"users": {}, "challenges": {}}

# Config

config = {"application":{"domain":"example.com","name":"SafeApp"},"challenges":{"showHints":True,"showMitigations":True,"xssBonusPayload":"<script>alert(1)</script>"}}

# Utils

def generate_token(length=32): return ''.join(random.choices(string.ascii_letters+string.digits,k=length))
def valid_email(email): return re.match(r"[^@]+@[^@]+.[^@]+", email)

async def create_users(users):
for u in users:
email = f"{u['email']}@{config['application']['domain']}" if not u.get("customDomain") else u["email"]
if not valid_email(email): logger.error(f"Invalid email: {email}"); continue
token = generate_token() if u.get("role")=="deluxe" else ""
profile = u.get("profileImage") or ("defaultAdmin.png" if u.get("role")=="admin" else "default.svg")
created = await UserModel.create({"username":u,"email":email,"password":u,"role":u.get("role"),"deluxeToken":token,"profileImage":f"assets/public/images/uploads/{profile}"})
datacache["users"][u["key"]]={"id":created,"username":created,"role":created.get("role")}

async def create_challenges(challenges):
for c in challenges:
desc = escape(c.get("description","")).replace("juice-sh.op",config["application"]["domain"])
created = await ChallengeModel.create({"key":c.get("key"),"name":c.get("name"),"category":c.get("category"),"tags":",".join(c.get("tags",[])),"description":desc,"difficulty":c.get("difficulty","Medium"),"solved":False})
datacache["challenges"][c.get("key")]=created
if config["challenges"]["showHints"] and c.get("hints"):
for i,hint in enumerate(c["hints"],1): await HintModel.create({"ChallengeId":created,"text":hint.replace("OWASP Juice Shop",config["application"]["name"]),"order":i,"unlocked":False})

async def create_wallets(users):
for i,u in enumerate(users,1): await WalletModel.create({"UserId":i,"balance":u.get("walletBalance",0)})

async def initialize_database(users, challenges):
await create_users(users); await create_challenges(challenges); await create_wallets(users)
logger.info("Database initialization complete.")

# Example data

static_users=[{"key":"user1","username":"alice","email":"alice","password":"pass123","role":"deluxe"},{"key":"user2","username":"bob","email":"bob","password":"pass456","role":"user"}]
static_challenges=[{"key":"chal1","name":"Challenge 1","category":"XSS","description":"<script>alert('XSS')</script>","hints":["Check input"],"tags":["XSS"]}]

asyncio.run(initialize_database(static_users, static_challenges))
