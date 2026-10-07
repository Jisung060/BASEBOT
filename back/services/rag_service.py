from langchain_chroma import Chroma
from langchain_google_genai import GoogleGenerativeAIEmbeddings


CHROMA_PATH = "./chroma_db"


embeddings = GoogleGenerativeAIEmbeddings(
    model="models/gemini-embedding-001"
)


vectorstore = Chroma(
    collection_name="basebot",
    embedding_function=embeddings,
    persist_directory=CHROMA_PATH,
)


def search_documents(
    question: str,
    k: int = 3,
):

    return vectorstore.similarity_search(
        question,
        k=k
    )