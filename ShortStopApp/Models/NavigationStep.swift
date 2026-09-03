import Foundation

struct NavigationStep: Identifiable, Codable, Equatable {
    let id: Int
    let instruction: String
    let detail: String?
}
