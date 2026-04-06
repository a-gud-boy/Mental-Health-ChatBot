import json
import chromadb
from openai import OpenAI
from sentence_transformers import SentenceTransformer

# 1. Connect to LM Studio's Local Server
# Point the client to the LM Studio localhost port. No API key needed!
client = OpenAI(base_url="http://localhost:1234/v1", api_key="lm-studio")

# 2. Setup Local Embeddings & Vector Database
print("[*] Loading local embedding model (this runs on CPU/RAM)...")
embedder = SentenceTransformer("all-MiniLM-L6-v2", device="cpu") 
chroma_client = chromadb.PersistentClient(path="./chroma_db")

# Create or load the collection
collection = chroma_client.get_or_create_collection(name="mental_health_rag")

def build_knowledge_base():
    # Only build if the database is empty to save time on subsequent runs
    if collection.count() == 0:
        print("[*] Building Vector Database from mental_health_kb.json...")
        with open("mental_health_kb.json", "r") as f:
            data = json.load(f)
            
        docs = []
        metadatas = []
        ids = []
        
        for idx, item in enumerate(data):
            # Combine the user issue and the helpful advice for deep semantic context
            advice = item["helpful_advice"][0]["advice_body"]
            full_text = f"User Issue: {item['user_issue_body']}\nAdvice: {advice}"
            
            docs.append(full_text)
            metadatas.append({"source": item["subreddit"]})
            ids.append(f"doc_{idx}")
            
        # Embed and store
        embeddings = embedder.encode(docs).tolist()
        collection.add(
            embeddings=embeddings,
            documents=docs,
            metadatas=metadatas,
            ids=ids
        )
        print("[+] Database built successfully!")
    else:
        print(f"[*] Vector DB already loaded with {collection.count()} documents.")

def get_rag_context(user_message):
    """Searches the vector database for relevant coping mechanisms."""
    query_embedding = embedder.encode(user_message).tolist()
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=2 # Pull the top 2 most relevant forum discussions
    )
    # Combine the retrieved documents into a single string
    context = "\n\n".join(results['documents'][0])
    return context

def chat():
    build_knowledge_base()
    
    print("\n" + "="*50)
    print("🧠 Track B RAG Chatbot is Online (Press Ctrl+C to exit)")
    print("="*50 + "\n")
    
    # chat_history = [
    #     {"role": "system", "content": "You are a specialized emotional support AI. You must read between the lines to detect underlying distress. NEVER use generic platitudes like 'I'm sorry you feel that way'. Use the provided RETRIEVED CONTEXT to offer specific, actionable mechanisms, but tailor the language to the user naturally."}
    # ]

    chat_history = [
        {"role": "system", "content": "You are a specialized, conversational emotional support AI. You must read between the lines to detect underlying distress. NEVER use generic platitudes like 'I'm sorry you feel that way'. \n\nRULES:\n1. Be CONCISE (maximum 3-4 sentences).\n2. Validate the specific emotion, do not just dispense advice.\n3. If RETRIEVED CONTEXT is provided, gently weave ONE mechanism into the conversation.\n4. ALWAYS end your response with a targeted, open-ended question that encourages the user to keep exploring their feelings."}
    ]
    
    while True:
        try:
            user_input = input("\nUser: ")
        except EOFError:
            print("\n[*] Input stream closed. Exiting chat.")
            break
        
        # 1. Retrieve relevant context from ChromaDB
        rag_context = get_rag_context(user_input)
        
        # 2. Inject context and user message into the prompt
        augmented_prompt = f"RETRIEVED CONTEXT:\n{rag_context}\n\nUSER MESSAGE:\n{user_input}"
        chat_history.append({"role": "user", "content": augmented_prompt})
        
        # 3. Send to LM Studio with streaming enabled
        try:
            response = client.chat.completions.create(
                model="local-model", 
                messages=chat_history,
                temperature=0.7,
                max_tokens=25753,
                reasoning_effort="low",
                stream=True # <-- This enables word-by-word streaming
            )
            
            print("\nAI: ", end="", flush=True)
            bot_reply = ""
            
            # Iterate through the incoming chunks and print them instantly
            for chunk in response:
                delta = chunk.choices[0].delta
                word = getattr(delta, "content", None)
                if word:
                    print(word, end="", flush=True)
                    bot_reply += word

            # Some reasoning-capable models stream mostly reasoning_content and
            # may emit little/no visible content tokens. Fallback once to a
            # non-streamed call so the user still gets an answer.
            if not bot_reply.strip():
                fallback = client.chat.completions.create(
                    model="local-model",
                    messages=chat_history,
                    temperature=0.7,
                    max_tokens=25753,
                    reasoning_effort="low",
                    stream=False
                )
                bot_reply = fallback.choices[0].message.content or ""
                if bot_reply:
                    print(bot_reply, end="", flush=True)
            
            print() # Add a final newline when the stream finishes
            
            # Save the bot's full reply to history
            chat_history[-1] = {"role": "user", "content": user_input} 
            chat_history.append({"role": "assistant", "content": bot_reply})
            
        except Exception as e:
            print(f"\n[Error connecting to LM Studio]: {e}")

if __name__ == "__main__":
    chat()