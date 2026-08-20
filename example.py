# Simple Python example demonstrating basic features

def calculate_average(numbers):
    """Calculate the average of a list of numbers."""
    if not numbers:
        return 0
    return sum(numbers) / len(numbers)

def main():
    # Sample data
    scores = [85, 92, 78, 95, 88]
    
    # Calculate and display average
    average = calculate_average(scores)
    print(f"Scores: {scores}")
    print(f"Average: {average:.2f}")
    
    # Filter high scores
    high_scores = [s for s in scores if s >= 90]
    print(f"High scores (≥90): {high_scores}")

if __name__ == "__main__":
    main()