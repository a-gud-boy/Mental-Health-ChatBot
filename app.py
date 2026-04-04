# streamlit run app.py

import streamlit as st
import chromadb
from openai import OpenAI
from sentence_transformers import SentenceTransformer

# --- Page Config ---
st.set_page_config(page_title="OpenAImer: Track B", page_icon="🧠", layout="centered")
st.title("🧠 Emotional Support AI")
st.caption("Powered by Gemma 26B, Local RAG, and PyTorch via RTX 5060")

# --- Initialize Connections (Cached so they don't reload every turn) ---
@st.cache_resource
def load_backend():
    client = OpenAI(base_url="http://localhost:1234/v1", api_key="lm-studio")
    embedder = SentenceTransformer("all-MiniLM-L6-v2", device="cpu")
    chroma_client = chromadb.PersistentClient(path="./chroma_db")
    collection = chroma_client.get_collection(name="mental_health_rag")
    return client, embedder, collection

client, embedder, collection = load_backend()

# --- Initialize Chat History ---
# We keep a visible history for the UI, and a hidden system history for the LLM
if "messages" not in st.session_state:
    st.session_state.messages = []
    st.session_state.llm_history = [
        {"role": "system", "content": "You are a specialized, conversational emotional support AI. You must read between the lines to detect underlying distress. NEVER use generic platitudes like 'I'm sorry you feel that way'. \n\nRULES:\n1. Be CONCISE (maximum 3-4 sentences).\n2. Validate the specific emotion, do not just dispense advice.\n3. If RETRIEVED CONTEXT is provided, gently weave ONE mechanism into the conversation.\n4. ALWAYS end your response with a targeted, open-ended question that encourages the user to keep exploring their feelings."}
    ]

# Display existing chat messages in the UI
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

# --- Chat Logic ---
if prompt := st.chat_input("Type your message here..."):
    # 1. Add user message to UI
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    # 2. Retrieve RAG Context
    query_embedding = embedder.encode(prompt).tolist()
    results = collection.query(query_embeddings=[query_embedding], n_results=1)
    rag_context = results['documents'][0][0] if results['documents'] else ""

    # 3. Augment the prompt for the LLM
    augmented_prompt = f"RETRIEVED CONTEXT:\n{rag_context}\n\nUSER MESSAGE:\n{prompt}"
    st.session_state.llm_history.append({"role": "user", "content": augmented_prompt})

    # 4. Stream response from LM Studio
    # 4. Stream response from LM Studio
    with st.chat_message("assistant"):
        # Create two separate containers: one for thoughts, one for the final reply
        think_container = st.container()
        msg_container = st.container()
        
        think_placeholder = None
        msg_placeholder = msg_container.empty()
        
        full_response = ""
        full_thinking = ""
        
        try:
            response = client.chat.completions.create(
                model="local-model",
                messages=st.session_state.llm_history,
                temperature=0.7,
                max_tokens=25753,
                reasoning_effort="low",
                stream=True
            )
            
            for chunk in response:
                if hasattr(chunk, 'choices') and len(chunk.choices) > 0:
                    delta = chunk.choices[0].delta
                    
                    # Look for both reasoning tokens AND standard content tokens
                    reasoning_word = getattr(delta, "reasoning_content", None)
                    content_word = getattr(delta, "content", None)
                    
                    # If the model is thinking, stream it into the expander
                    if reasoning_word:
                        if think_placeholder is None:
                            # Create the UI expander the exact millisecond the first thought arrives
                            with think_container.expander("🧠 Internal Reasoning Process", expanded=True):
                                think_placeholder = st.empty()
                        full_thinking += reasoning_word
                        think_placeholder.markdown(full_thinking + "▌")
                        
                    # If the model is speaking to the user, stream it to the main chat bubble
                    if content_word:
                        full_response += content_word
                        msg_placeholder.markdown(full_response + "▌")
            
            # Clean up the blinking cursors when the stream finishes
            if think_placeholder is not None:
                think_placeholder.markdown(full_thinking)
            if full_response.strip():
                msg_placeholder.markdown(full_response)
            
            # Fallback for models that fail to stream properly
            if not full_response.strip():
                fallback = client.chat.completions.create(
                    model="local-model",
                    messages=st.session_state.llm_history,
                    temperature=0.7,
                    max_tokens=25753,
                    reasoning_effort="low",
                    stream=False
                )
                full_response = fallback.choices[0].message.content or ""
                msg_placeholder.markdown(full_response)
                
        except Exception as e:
            st.error(f"Failed to connect to local server: {e}")
            
    # 5. Save the final response (We DO NOT save the thinking process to memory)
    st.session_state.messages.append({"role": "assistant", "content": full_response})
    
    # Strip the RAG context from the user's turn in the history to save memory
    st.session_state.llm_history[-1] = {"role": "user", "content": prompt}
    st.session_state.llm_history.append({"role": "assistant", "content": full_response})