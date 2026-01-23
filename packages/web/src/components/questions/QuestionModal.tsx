import { useState } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useStore, Question } from '../../stores/store';

interface QuestionModalProps {
    question: Question;
}

export function QuestionModal({ question }: QuestionModalProps) {
    const [response, setResponse] = useState('');
    const { answerQuestion } = useWebSocket();
    const { removeQuestion } = useStore();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!response.trim()) return;

        answerQuestion(question.id, response);
        removeQuestion(question.id);
        setResponse('');
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-gray-800 rounded-lg max-w-lg w-full p-6">
                <h2 className="text-xl font-semibold mb-4">Claude needs your input</h2>

                <div className="bg-gray-900 rounded p-4 mb-4">
                    <p className="text-sm text-gray-400 mb-1">
                        From: {question.claude_instance_id.slice(0, 8)}
                    </p>
                    <p className="whitespace-pre-wrap">{question.question}</p>
                </div>

                <form onSubmit={handleSubmit}>
                    <textarea
                        value={response}
                        onChange={(e) => setResponse(e.target.value)}
                        placeholder="Your response..."
                        className="w-full bg-gray-700 rounded px-4 py-3 mb-4 h-32 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                    />

                    <div className="flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                removeQuestion(question.id);
                            }}
                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
                        >
                            Skip
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
                        >
                            Send Response
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
